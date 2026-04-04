'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── GET /api/me ───────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({
    id:           req.user.id,
    username:     req.user.username,
    display_name: req.user.display_name,
    email:        req.user.email,
    totp_enabled: Boolean(req.user.totp_enabled),
  });
});

// ── PUT /api/me ───────────────────────────────────────────────────────────────
router.put('/', (req, res, next) => {
  try {
    const { display_name, username, email } = req.body;

    if (username !== undefined) {
      if (!/^[a-z0-9_]{3,40}$/i.test(username?.trim())) {
        return res.status(400).json({ error: 'Invalid username format' });
      }
      const conflict = db.prepare(
        'SELECT id FROM users WHERE username = ? AND id != ?'
      ).get(username.trim(), req.user.id);
      if (conflict) return res.status(409).json({ error: 'Username already taken' });
    }

    db.prepare(`
      UPDATE users SET
        display_name = COALESCE(?, display_name),
        username     = COALESCE(?, username),
        email        = COALESCE(?, email),
        updated_at   = datetime('now')
      WHERE id = ?
    `).run(
      display_name?.trim() || null,
      username?.trim()      || null,
      email?.trim().toLowerCase() || null,
      req.user.id
    );

    const updated = db.prepare(
      'SELECT id, username, display_name, email, totp_enabled FROM users WHERE id = ?'
    ).get(req.user.id);

    res.json({ ok: true, user: updated });
  } catch (err) { next(err); }
});

// ── PUT /api/me/password ──────────────────────────────────────────────────────
router.put('/password', async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const row   = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const match = await bcrypt.compare(current_password, row.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(new_password, 12);
    db.prepare(
      "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newHash, req.user.id);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/me/2fa/setup ────────────────────────────────────────────────────
// Generates a TOTP secret and returns a QR code data URL.
// The secret is stored temporarily — only activated after /verify.
router.post('/2fa/setup', (req, res, next) => {
  try {
    const speakeasy = require('speakeasy');
    const qrcode    = require('qrcode');

    const user   = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(req.user.id);
    const label  = user.display_name || user.username;
    const secret = speakeasy.generateSecret({
      name:   `AdvoHQ (${label})`,
      issuer: 'AdvoHQ',
      length: 32,
    });

    // Store the pending secret (totp_enabled stays 0 until verify)
    db.prepare(
      "UPDATE users SET totp_secret = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(secret.base32, req.user.id);

    qrcode.toDataURL(secret.otpauth_url, { width: 220, margin: 1 }, (err, dataUrl) => {
      if (err) return next(new Error('QR code generation failed'));
      res.json({ qr_url: dataUrl, secret: secret.base32 });
    });
  } catch (err) { next(err); }
});

// ── POST /api/me/2fa/verify ───────────────────────────────────────────────────
// Verifies the TOTP code and enables 2FA if correct.
router.post('/2fa/verify', (req, res, next) => {
  try {
    const speakeasy = require('speakeasy');
    const { totp_code } = req.body;
    if (!totp_code) return res.status(400).json({ error: 'totp_code required' });

    const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(req.user.id);
    if (!user.totp_secret) {
      return res.status(400).json({ error: 'Run 2FA setup first' });
    }

    const valid = speakeasy.totp.verify({
      secret:   user.totp_secret,
      encoding: 'base32',
      token:    String(totp_code).replace(/\s/g, ''),
      window:   1,
    });
    if (!valid) return res.status(401).json({ error: 'Invalid code. Try again.' });

    db.prepare(
      "UPDATE users SET totp_enabled = 1, updated_at = datetime('now') WHERE id = ?"
    ).run(req.user.id);

    res.json({ ok: true, message: '2FA enabled successfully' });
  } catch (err) { next(err); }
});

// ── DELETE /api/me/2fa ────────────────────────────────────────────────────────
router.delete('/2fa', (req, res, next) => {
  try {
    db.prepare(
      "UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = datetime('now') WHERE id = ?"
    ).run(req.user.id);
    res.json({ ok: true, message: '2FA disabled' });
  } catch (err) { next(err); }
});

// ── GET /api/me/sessions ──────────────────────────────────────────────────────
router.get('/sessions', (req, res, next) => {
  try {
    const sessions = db.prepare(`
      SELECT id, device_info, ip_address, created_at, expires_at
      FROM   sessions
      WHERE  user_id = ? AND expires_at > datetime('now')
      ORDER  BY created_at DESC
    `).all(req.user.id);
    res.json(sessions);
  } catch (err) { next(err); }
});

// ── DELETE /api/me/sessions/:id — revoke a specific session ──────────────────
router.delete('/sessions/:id', (req, res, next) => {
  try {
    db.prepare(
      'DELETE FROM sessions WHERE id = ? AND user_id = ?'
    ).run(parseInt(req.params.id, 10), req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/me/sessions — revoke all other sessions ──────────────────────
// Body: { current_token_hash: "sha256 of current refresh token" }
router.delete('/sessions', (req, res, next) => {
  try {
    const { current_token_hash } = req.body;
    if (current_token_hash) {
      db.prepare(
        'DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'
      ).run(req.user.id, current_token_hash);
    } else {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/me/memories ──────────────────────────────────────────────────────
router.get('/memories', (req, res, next) => {
  try {
    const rows = db.prepare(
      'SELECT id, content, created_at FROM memories WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/me/memories ─────────────────────────────────────────────────────
router.post('/memories', (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });
    const result = db.prepare(
      'INSERT INTO memories (user_id, content) VALUES (?, ?)'
    ).run(req.user.id, content.trim().slice(0, 1000));
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ── DELETE /api/me/memories/:id ──────────────────────────────────────────────
router.delete('/memories/:id', (req, res, next) => {
  try {
    db.prepare(
      'DELETE FROM memories WHERE id = ? AND user_id = ?'
    ).run(parseInt(req.params.id, 10), req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/me/memories — clear all ──────────────────────────────────────
router.delete('/memories', (req, res, next) => {
  try {
    db.prepare('DELETE FROM memories WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/me/export — full data export as JSON attachment ──────────────────
router.get('/export', (req, res, next) => {
  try {
    const uid = req.user.id;

    const user = db.prepare(
      'SELECT id, username, display_name, email, created_at FROM users WHERE id = ?'
    ).get(uid);

    const cases = db.prepare(
      'SELECT * FROM cases WHERE user_id = ? ORDER BY created_at'
    ).all(uid);

    const caseIds = cases.map(c => c.id);
    let caseFiles = [], caseDates = [];
    if (caseIds.length) {
      const ph = caseIds.map(() => '?').join(',');
      caseFiles = db.prepare(
        `SELECT * FROM case_files WHERE case_id IN (${ph})`
      ).all(...caseIds);
      caseDates = db.prepare(
        `SELECT * FROM case_dates WHERE case_id IN (${ph})`
      ).all(...caseIds);
    }

    const library  = db.prepare(
      'SELECT id, name, type, size, assigned_to, next_date, end_date, trashed, created_at, updated_at FROM library_items WHERE user_id = ?'
    ).all(uid);

    const memories = db.prepare(
      'SELECT id, content, created_at FROM memories WHERE user_id = ?'
    ).all(uid);

    const payload = {
      exported_at: new Date().toISOString(),
      user,
      cases: cases.map(c => ({
        ...c,
        files: caseFiles.filter(f => f.case_id === c.id),
        dates: caseDates.filter(d => d.case_id === c.id),
      })),
      library,
      memories,
    };

    res.setHeader('Content-Disposition', 'attachment; filename="advohq-export.json"');
    res.setHeader('Content-Type', 'application/json');
    res.json(payload);
  } catch (err) { next(err); }
});

module.exports = router;

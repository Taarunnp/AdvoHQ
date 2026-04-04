'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── Token helpers ─────────────────────────────────────────────────────────────

function signAccess(userId) {
  return jwt.sign(
    { sub: userId },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_TTL || '15m' }
  );
}

function signRefresh(userId) {
  const days = parseInt(process.env.JWT_REFRESH_DAYS || '7', 10);
  return jwt.sign(
    { sub: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: `${days}d` }
  );
}

/** Deterministic SHA-256 of a token so we never store the token itself */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function refreshTTL() {
  const days = parseInt(process.env.JWT_REFRESH_DAYS || '7', 10);
  return days * 24 * 60 * 60 * 1000; // ms
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
// Creates the first admin user; locked after first user unless ALLOW_REGISTRATION=true
router.post('/register', async (req, res, next) => {
  try {
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (count > 0 && process.env.ALLOW_REGISTRATION !== 'true') {
      return res.status(403).json({ error: 'Registration is closed.' });
    }

    const { username, password, display_name, email } = req.body;

    if (!username?.trim() || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/^[a-z0-9_]{3,40}$/i.test(username.trim())) {
      return res.status(400).json({ error: 'Username: 3–40 chars, letters/numbers/underscores only' });
    }

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
    if (exists) return res.status(409).json({ error: 'Username already taken' });

    const hash   = await bcrypt.hash(password, 12);
    const result = db.prepare(`
      INSERT INTO users (username, display_name, email, password_hash)
      VALUES (?, ?, ?, ?)
    `).run(
      username.trim(),
      (display_name?.trim() || username.trim()),
      email?.trim().toLowerCase() || null,
      hash
    );

    res.status(201).json({
      id:       result.lastInsertRowid,
      username: username.trim(),
      message:  'Account created. You can now sign in.',
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { username, password, totp_code } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());

    // Always run bcrypt to prevent timing attacks, even when user not found
    const sentinel = '$2b$12$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const hash     = user ? user.password_hash : sentinel;
    const match    = await bcrypt.compare(password, hash);

    if (!user || !match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // ── 2FA check ──────────────────────────────────────────────────────────
    if (user.totp_enabled) {
      if (!totp_code) {
        // Signal the frontend to show the TOTP input step
        return res.status(200).json({ require_totp: true });
      }
      const speakeasy = require('speakeasy');
      const valid = speakeasy.totp.verify({
        secret:   user.totp_secret,
        encoding: 'base32',
        token:    String(totp_code).replace(/\s/g, ''),
        window:   1,
      });
      if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    // ── Issue tokens ────────────────────────────────────────────────────────
    const accessToken  = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    const tokenHash    = hashToken(refreshToken);
    const expiresAt    = new Date(Date.now() + refreshTTL()).toISOString();

    // Prune expired sessions before inserting
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

    const deviceInfo = (req.headers['user-agent'] || 'Unknown').slice(0, 300);
    const ipAddr     = (req.headers['x-forwarded-for'] || req.ip || '').slice(0, 45);

    db.prepare(`
      INSERT INTO sessions (user_id, token_hash, device_info, ip_address, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, tokenHash, deviceInfo, ipAddr, expiresAt);

    res.json({
      access_token:  accessToken,
      refresh_token: refreshToken,
      user: {
        id:           user.id,
        username:     user.username,
        display_name: user.display_name,
        email:        user.email,
        totp_enabled: Boolean(user.totp_enabled),
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });

    let payload;
    try {
      payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const hash    = hashToken(refresh_token);
    const session = db.prepare(
      "SELECT id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')"
    ).get(hash);

    if (!session) {
      return res.status(401).json({ error: 'Session not found or expired. Please log in again.' });
    }

    const newAccess = signAccess(payload.sub);
    res.json({ access_token: newAccess });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      const hash = hashToken(refresh_token);
      db.prepare('DELETE FROM sessions WHERE token_hash = ? AND user_id = ?').run(hash, req.user.id);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

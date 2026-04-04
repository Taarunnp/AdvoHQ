'use strict';

const router = require('express').Router();
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch a case owned by the current user (or 404) */
function ownedCase(id, userId, res) {
  const c = db.prepare(
    'SELECT * FROM cases WHERE id = ? AND user_id = ?'
  ).get(parseInt(id, 10), userId);
  if (!c) res.status(404).json({ error: 'Case not found' });
  return c;
}

/** Attach files and dates to a case row */
function enrich(c) {
  const files = db.prepare(
    'SELECT id, name, added_at FROM case_files WHERE case_id = ? ORDER BY added_at ASC'
  ).all(c.id);
  const dates = db.prepare(
    'SELECT id, date_iso, label, notified, added_at FROM case_dates WHERE case_id = ? ORDER BY date_iso ASC'
  ).all(c.id);
  return { ...c, files, importantDates: dates };
}

// ── GET /api/cases ────────────────────────────────────────────────────────────
router.get('/', (req, res, next) => {
  try {
    const { q } = req.query;
    let query  = 'SELECT * FROM cases WHERE user_id = ?';
    const args = [req.user.id];

    if (q?.trim()) {
      query += ' AND title LIKE ?';
      args.push(`%${q.trim()}%`);
    }
    query += ' ORDER BY created_at DESC';

    const rows = db.prepare(query).all(...args);
    res.json(rows.map(enrich));
  } catch (err) { next(err); }
});

// ── GET /api/cases/upcoming-dates ─────────────────────────────────────────────
// Returns dates within the next 3 days for the notification banner.
// Placed before /:id so the static segment matches first.
router.get('/upcoming-dates', (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const plus3 = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const rows = db.prepare(`
      SELECT cd.id, cd.case_id, cd.date_iso, cd.label, cd.notified, c.title AS case_title
      FROM   case_dates cd
      JOIN   cases      c  ON c.id = cd.case_id
      WHERE  c.user_id  = ?
        AND  cd.date_iso BETWEEN ? AND ?
      ORDER  BY cd.date_iso
    `).all(req.user.id, today, plus3);

    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/cases/:id ────────────────────────────────────────────────────────
router.get('/:id', (req, res, next) => {
  try {
    const c = ownedCase(req.params.id, req.user.id, res);
    if (!c) return;
    res.json(enrich(c));
  } catch (err) { next(err); }
});

// ── POST /api/cases ───────────────────────────────────────────────────────────
router.post('/', (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

    const result = db.prepare(
      'INSERT INTO cases (user_id, title) VALUES (?, ?)'
    ).run(req.user.id, title.trim().slice(0, 500));

    const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(enrich(c));
  } catch (err) { next(err); }
});

// ── PUT /api/cases/:id ────────────────────────────────────────────────────────
// Can update title and/or points in one call.
router.put('/:id', (req, res, next) => {
  try {
    const c = ownedCase(req.params.id, req.user.id, res);
    if (!c) return;

    const { title, points } = req.body;

    db.prepare(`
      UPDATE cases SET
        title      = COALESCE(?, title),
        points     = COALESCE(?, points),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title?.trim().slice(0, 500) || null,
      typeof points === 'string' ? points : null,
      c.id
    );

    const updated = db.prepare('SELECT * FROM cases WHERE id = ?').get(c.id);
    res.json(enrich(updated));
  } catch (err) { next(err); }
});

// ── DELETE /api/cases/:id ─────────────────────────────────────────────────────
router.delete('/:id', (req, res, next) => {
  try {
    const c = ownedCase(req.params.id, req.user.id, res);
    if (!c) return;
    db.prepare('DELETE FROM cases WHERE id = ?').run(c.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/cases/:id/files ─────────────────────────────────────────────────
router.post('/:id/files', (req, res, next) => {
  try {
    const c = ownedCase(req.params.id, req.user.id, res);
    if (!c) return;

    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const result = db.prepare(
      'INSERT INTO case_files (case_id, name) VALUES (?, ?)'
    ).run(c.id, name.trim().slice(0, 500));

    const file = db.prepare(
      'SELECT * FROM case_files WHERE id = ?'
    ).get(result.lastInsertRowid);

    res.status(201).json(file);
  } catch (err) { next(err); }
});

// ── DELETE /api/cases/:id/files/:fileId ──────────────────────────────────────
router.delete('/:id/files/:fileId', (req, res, next) => {
  try {
    const c = ownedCase(req.params.id, req.user.id, res);
    if (!c) return;

    db.prepare(
      'DELETE FROM case_files WHERE id = ? AND case_id = ?'
    ).run(parseInt(req.params.fileId, 10), c.id);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/cases/:id/dates ─────────────────────────────────────────────────
router.post('/:id/dates', (req, res, next) => {
  try {
    const c = ownedCase(req.params.id, req.user.id, res);
    if (!c) return;

    const { date_iso, label } = req.body;
    if (!date_iso || !label?.trim()) {
      return res.status(400).json({ error: 'date_iso and label are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date_iso)) {
      return res.status(400).json({ error: 'date_iso must be YYYY-MM-DD' });
    }

    const result = db.prepare(
      'INSERT INTO case_dates (case_id, date_iso, label) VALUES (?, ?, ?)'
    ).run(c.id, date_iso, label.trim().slice(0, 300));

    const row = db.prepare(
      'SELECT * FROM case_dates WHERE id = ?'
    ).get(result.lastInsertRowid);

    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ── PATCH /api/cases/:id/dates/:dateId — mark notified ───────────────────────
router.patch('/:id/dates/:dateId', (req, res, next) => {
  try {
    const c = ownedCase(req.params.id, req.user.id, res);
    if (!c) return;

    db.prepare(
      'UPDATE case_dates SET notified = 1 WHERE id = ? AND case_id = ?'
    ).run(parseInt(req.params.dateId, 10), c.id);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/cases/:id/dates/:dateId ──────────────────────────────────────
router.delete('/:id/dates/:dateId', (req, res, next) => {
  try {
    const c = ownedCase(req.params.id, req.user.id, res);
    if (!c) return;

    db.prepare(
      'DELETE FROM case_dates WHERE id = ? AND case_id = ?'
    ).run(parseInt(req.params.dateId, 10), c.id);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

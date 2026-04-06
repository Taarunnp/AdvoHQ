// routes/schedule.js — Calendar events CRUD
const router      = require('express').Router();
const requireAuth = require('../middleware/auth');
const pool        = require('../db/db');

router.use(requireAuth);

// GET /api/schedule — all events, optional ?month=YYYY-MM
router.get('/', async (req, res) => {
  const { month } = req.query; // e.g. "2026-04"
  try {
    let query  = `SELECT * FROM events WHERE user_id = $1`;
    const args = [req.user.id];

    if (month) {
      query += ` AND TO_CHAR(event_date,'YYYY-MM') = $2`;
      args.push(month);
    }

    query += ` ORDER BY event_date ASC, event_time ASC`;
    const { rows } = await pool.query(query, args);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/schedule — create event
router.post('/', async (req, res) => {
  const { case_id, case_name, event_type, event_date, event_time, location, judge, notes } = req.body;

  if (!case_name || !event_type || !event_date) {
    return res.status(400).json({ error: 'case_name, event_type and event_date are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO events (user_id, case_id, case_name, event_type, event_date, event_time, location, judge, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [req.user.id, case_id || null, case_name, event_type, event_date, event_time || null, location, judge, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/schedule/:id
router.patch('/:id', async (req, res) => {
  const { case_name, event_type, event_date, event_time, location, judge, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE events SET
         case_name  = COALESCE($1, case_name),
         event_type = COALESCE($2, event_type),
         event_date = COALESCE($3, event_date),
         event_time = COALESCE($4, event_time),
         location   = COALESCE($5, location),
         judge      = COALESCE($6, judge),
         notes      = COALESCE($7, notes)
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [case_name, event_type, event_date, event_time, location, judge, notes, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/schedule/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM events WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Event not found' });
    res.json({ message: 'Event deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

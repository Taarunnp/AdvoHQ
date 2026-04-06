// routes/cases.js — CRUD for legal cases
const router      = require('express').Router();
const requireAuth = require('../middleware/auth');
const pool        = require('../db/db');

router.use(requireAuth);

// GET /api/cases — list all cases for this user
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM cases WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/cases/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM cases WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Case not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/cases — create new case
router.post('/', async (req, res) => {
  const { title, client_name, case_type, status, court, judge, filing_date, notes } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO cases (user_id, title, client_name, case_type, status, court, judge, filing_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [req.user.id, title, client_name, case_type, status || 'active', court, judge, filing_date || null, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/cases/:id — update case
router.patch('/:id', async (req, res) => {
  const { title, client_name, case_type, status, court, judge, filing_date, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE cases SET
         title       = COALESCE($1, title),
         client_name = COALESCE($2, client_name),
         case_type   = COALESCE($3, case_type),
         status      = COALESCE($4, status),
         court       = COALESCE($5, court),
         judge       = COALESCE($6, judge),
         filing_date = COALESCE($7, filing_date),
         notes       = COALESCE($8, notes),
         updated_at  = NOW()
       WHERE id = $9 AND user_id = $10
       RETURNING *`,
      [title, client_name, case_type, status, court, judge, filing_date || null, notes, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Case not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/cases/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM cases WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Case not found' });
    res.json({ message: 'Case deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

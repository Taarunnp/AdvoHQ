// routes/auth.js — Register & Login
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/db');

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, username, password } = req.body;

  if (!name || !email || !username || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, username, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, username, created_at`,
      [name.trim(), email.toLowerCase().trim(), username.toLowerCase().trim(), hash]
    );
    const user  = rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') {
      // Unique constraint — email or username already taken
      const field = err.detail?.includes('email') ? 'Email' : 'Username';
      return res.status(409).json({ error: `${field} is already in use` });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { login, password } = req.body; // login = email OR username

  if (!login || !password) {
    return res.status(400).json({ error: 'Login and password are required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM users
       WHERE email = $1 OR username = $1
       LIMIT 1`,
      [login.toLowerCase().trim()]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)  return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    const { password: _pw, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
const requireAuth = require('../middleware/auth');

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, username, avatar_url, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/auth/me ───────────────────────────────────────────────────────
router.patch('/me', requireAuth, async (req, res) => {
  const { name, username } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET
         name     = COALESCE($1, name),
         username = COALESCE($2, username)
       WHERE id = $3
       RETURNING id, name, email, username, avatar_url`,
      [name?.trim() || null, username?.toLowerCase().trim() || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

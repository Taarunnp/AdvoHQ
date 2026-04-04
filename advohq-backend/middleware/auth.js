'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../db');

/**
 * Validates the Authorization: Bearer <access_token> header.
 * Attaches req.user = { id, username, display_name, email, totp_enabled }
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Token expired'
      : 'Invalid token';
    return res.status(401).json({ error: msg });
  }

  const user = db.prepare(
    'SELECT id, username, display_name, email, totp_enabled FROM users WHERE id = ?'
  ).get(payload.sub);

  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  req.user = user;
  next();
}

module.exports = { requireAuth };

'use strict';

const rateLimit = require('express-rate-limit');

/** General API — 200 requests per 15 min */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  skip: (req) => req.method === 'OPTIONS',
});

/** Auth endpoints (login, register) — 20 per 15 min to deter brute-force */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please try again later.' },
});

/** AI proxy — 15 per minute per IP to control API costs */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI request limit reached. Please wait a moment.' },
});

module.exports = { generalLimiter, authLimiter, aiLimiter };

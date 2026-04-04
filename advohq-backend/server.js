'use strict';

require('dotenv').config();

// Validate required environment variables at startup
const REQUIRED_ENV = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`);
  console.error('        Copy .env.example → .env and fill in the values.');
  process.exit(1);
}

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');

const { generalLimiter, authLimiter } = require('./middleware/rateLimit');

const app = express();

// ── Trust proxy (for correct IP behind Nginx / Render / Railway) ─────────────
app.set('trust proxy', 1);

// ── Security headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   [
        "'self'", "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://cdnjs.cloudflare.com',
      ],
      styleSrc:    [
        "'self'", "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://cdnjs.cloudflare.com',
      ],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // needed for PDF rendering in iframes
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin(origin, cb) {
    // Allow same-origin requests (no origin header) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Static files (place your HTML files in /public) ──────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag:         true,
  lastModified: true,
  index:        'index.html',
}));

// ── API rate limiting ─────────────────────────────────────────────────────────
app.use('/api/',       generalLimiter);
app.use('/api/auth/',  authLimiter);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/me',      require('./routes/me'));
app.use('/api/cases',   require('./routes/cases'));
app.use('/api/library', require('./routes/library'));
app.use('/api/ai',      require('./routes/ai'));

// ── Health check (useful for uptime monitors & deploy checks) ─────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── SPA fallback — serve index.html for all non-API routes ───────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // Don't leak stack traces in production
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) console.error(err.stack);

  const status  = err.status || 500;
  const message = status < 500 ? err.message : (isDev ? err.message : 'Internal server error');
  res.status(status).json({ error: message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`\n  ⚖  AdvoHQ backend running → http://localhost:${PORT}`);
  console.log(`     ENV : ${process.env.NODE_ENV || 'development'}`);
  console.log(`     CORS: ${allowedOrigins.join(', ')}\n`);
});

module.exports = app; // for testing

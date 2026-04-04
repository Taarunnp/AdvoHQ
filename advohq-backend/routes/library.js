'use strict';

const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── Upload storage ────────────────────────────────────────────────────────────

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = path.join(UPLOAD_ROOT, String(req.user.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const rand = crypto.randomBytes(16).toString('hex');
    const ext  = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${rand}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }, // 25 MB per file, 20 files per request
  fileFilter(_req, file, cb) {
    ALLOWED_MIME.has(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
});

// ── Utility helpers ───────────────────────────────────────────────────────────

function getFileType(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf')                         return 'pdf';
  if (['.doc', '.docx'].includes(ext))        return 'docx';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return 'xlsx';
  if (['.ppt', '.pptx'].includes(ext))        return 'pptx';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'img';
  return 'txt';
}

function formatSize(bytes) {
  if (bytes < 1024)             return bytes + ' B';
  if (bytes < 1024 * 1024)     return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function ownedItem(id, userId, res) {
  const item = db.prepare(
    'SELECT * FROM library_items WHERE id = ? AND user_id = ?'
  ).get(parseInt(id, 10), userId);
  if (!item) res.status(404).json({ error: 'Item not found' });
  return item;
}

// ── GET /api/library ──────────────────────────────────────────────────────────
router.get('/', (req, res, next) => {
  try {
    const { trash = 'false', q, type, parent_id } = req.query;
    const trashed = trash === 'true' ? 1 : 0;

    let query = 'SELECT * FROM library_items WHERE user_id = ? AND trashed = ?';
    const args = [req.user.id, trashed];

    if (q?.trim()) {
      query += ' AND name LIKE ?';
      args.push(`%${q.trim()}%`);
    }
    if (type) {
      query += ' AND type = ?';
      args.push(type);
    }
    if (parent_id !== undefined) {
      if (parent_id === 'null' || parent_id === '') {
        query += ' AND parent_id IS NULL';
      } else {
        query += ' AND parent_id = ?';
        args.push(parseInt(parent_id, 10));
      }
    }

    query += " ORDER BY (type = 'folder') DESC, updated_at DESC";
    const items = db.prepare(query).all(...args);

    // Count children for each folder in one query
    const folderIds = items.filter(i => i.type === 'folder').map(i => i.id);
    const countMap  = {};
    if (folderIds.length) {
      const ph = folderIds.map(() => '?').join(',');
      const counts = db.prepare(
        `SELECT parent_id, COUNT(*) AS c FROM library_items WHERE parent_id IN (${ph}) AND trashed = 0 GROUP BY parent_id`
      ).all(...folderIds);
      counts.forEach(r => { countMap[r.parent_id] = r.c; });
    }

    res.json(items.map(i => ({ ...i, items: countMap[i.id] || 0 })));
  } catch (err) { next(err); }
});

// ── GET /api/library/storage ──────────────────────────────────────────────────
router.get('/storage', (req, res, next) => {
  try {
    const sizes = db.prepare(
      "SELECT size FROM library_items WHERE user_id = ? AND type != 'folder' AND trashed = 0"
    ).all(req.user.id);

    // Parse "123 KB" / "4.5 MB" strings back to bytes
    let totalBytes = 0;
    const parseSize = s => {
      if (!s || s === '—' || s === '0 KB') return 0;
      const [n, u] = s.split(' ');
      const v = parseFloat(n) || 0;
      if (u === 'MB') return Math.round(v * 1024 * 1024);
      if (u === 'GB') return Math.round(v * 1024 * 1024 * 1024);
      if (u === 'KB') return Math.round(v * 1024);
      return v;
    };
    sizes.forEach(r => { totalBytes += parseSize(r.size); });

    const QUOTA = 5 * 1024 * 1024 * 1024; // 5 GB quota
    res.json({
      used_bytes:  totalBytes,
      quota_bytes: QUOTA,
      percent:     Math.min((totalBytes / QUOTA) * 100, 100).toFixed(1),
    });
  } catch (err) { next(err); }
});

// ── POST /api/library/folder ──────────────────────────────────────────────────
router.post('/folder', (req, res, next) => {
  try {
    const { name, parent_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const result = db.prepare(`
      INSERT INTO library_items (user_id, name, type, parent_id)
      VALUES (?, ?, 'folder', ?)
    `).run(req.user.id, name.trim().slice(0, 500), parent_id ? parseInt(parent_id, 10) : null);

    const item = db.prepare('SELECT * FROM library_items WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ...item, items: 0 });
  } catch (err) { next(err); }
});

// ── POST /api/library/upload ──────────────────────────────────────────────────
router.post('/upload', (req, res, next) => {
  upload.array('files', 20)(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: 'File exceeds the 25 MB limit' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.files?.length) {
      return res.status(400).json({ error: 'No files received' });
    }

    const stmt = db.prepare(`
      INSERT INTO library_items (user_id, name, type, size, disk_path, parent_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const uploaded = [];
    for (const f of req.files) {
      const r = stmt.run(
        req.user.id,
        f.originalname.slice(0, 500),
        getFileType(f.originalname),
        formatSize(f.size),
        f.path,
        req.body.parent_id ? parseInt(req.body.parent_id, 10) : null
      );
      uploaded.push(db.prepare('SELECT * FROM library_items WHERE id = ?').get(r.lastInsertRowid));
    }

    res.status(201).json(uploaded);
  });
});

// ── GET /api/library/:id ──────────────────────────────────────────────────────
router.get('/:id', (req, res, next) => {
  try {
    const item = ownedItem(req.params.id, req.user.id, res);
    if (!item) return;
    res.json(item);
  } catch (err) { next(err); }
});

// ── PUT /api/library/:id ──────────────────────────────────────────────────────
router.put('/:id', (req, res, next) => {
  try {
    const item = ownedItem(req.params.id, req.user.id, res);
    if (!item) return;

    const { name, assigned_to, next_date, end_date, parent_id } = req.body;

    db.prepare(`
      UPDATE library_items SET
        name        = COALESCE(?, name),
        assigned_to = COALESCE(?, assigned_to),
        next_date   = COALESCE(?, next_date),
        end_date    = COALESCE(?, end_date),
        parent_id   = COALESCE(?, parent_id),
        updated_at  = datetime('now')
      WHERE id = ?
    `).run(
      name?.trim().slice(0, 500)  || null,
      assigned_to?.trim()          ?? null,
      next_date?.trim()            ?? null,
      end_date?.trim()             ?? null,
      parent_id !== undefined ? (parent_id ? parseInt(parent_id, 10) : null) : undefined,
      item.id
    );

    res.json(db.prepare('SELECT * FROM library_items WHERE id = ?').get(item.id));
  } catch (err) { next(err); }
});

// ── DELETE /api/library/:id ───────────────────────────────────────────────────
// ?permanent=true to hard-delete; otherwise moves to trash
router.delete('/:id', (req, res, next) => {
  try {
    const item = ownedItem(req.params.id, req.user.id, res);
    if (!item) return;

    if (req.query.permanent === 'true') {
      if (item.disk_path && fs.existsSync(item.disk_path)) {
        try { fs.unlinkSync(item.disk_path); } catch (_) { /* ignore */ }
      }
      db.prepare('DELETE FROM library_items WHERE id = ?').run(item.id);
    } else {
      db.prepare(
        "UPDATE library_items SET trashed = 1, updated_at = datetime('now') WHERE id = ?"
      ).run(item.id);
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/library/:id/restore ────────────────────────────────────────────
router.post('/:id/restore', (req, res, next) => {
  try {
    const item = ownedItem(req.params.id, req.user.id, res);
    if (!item) return;

    db.prepare(
      "UPDATE library_items SET trashed = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(item.id);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/library/:id/download ────────────────────────────────────────────
router.get('/:id/download', (req, res, next) => {
  try {
    const item = ownedItem(req.params.id, req.user.id, res);
    if (!item) return;
    if (!item.disk_path || !fs.existsSync(item.disk_path)) {
      return res.status(404).json({ error: 'File not available on disk' });
    }
    res.download(item.disk_path, item.name);
  } catch (err) { next(err); }
});

// ── Notes (used by advohq-file.html AI/notes panel) ──────────────────────────

// GET /api/library/notes?file_id=123
router.get('/notes/list', (req, res, next) => {
  try {
    const { file_id } = req.query;
    let query = 'SELECT * FROM file_notes WHERE user_id = ?';
    const args = [req.user.id];
    if (file_id) {
      query += ' AND file_id = ?';
      args.push(parseInt(file_id, 10));
    }
    query += ' ORDER BY created_at DESC';
    res.json(db.prepare(query).all(...args));
  } catch (err) { next(err); }
});

// POST /api/library/notes
router.post('/notes/list', (req, res, next) => {
  try {
    const { text, file_id } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

    const result = db.prepare(
      'INSERT INTO file_notes (user_id, file_id, text) VALUES (?, ?, ?)'
    ).run(req.user.id, file_id ? parseInt(file_id, 10) : null, text.trim().slice(0, 5000));

    res.status(201).json(db.prepare('SELECT * FROM file_notes WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) { next(err); }
});

// DELETE /api/library/notes/:id
router.delete('/notes/:noteId', (req, res, next) => {
  try {
    db.prepare(
      'DELETE FROM file_notes WHERE id = ? AND user_id = ?'
    ).run(parseInt(req.params.noteId, 10), req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

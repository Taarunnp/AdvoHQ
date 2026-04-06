// routes/files.js — Upload to S3, list, delete
const router      = require('express').Router();
const requireAuth = require('../middleware/auth');
const pool        = require('../db/db');
const { upload, s3 } = require('../config/s3');
const { DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

router.use(requireAuth);

// POST /api/files/upload — upload a single file to S3
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { case_id } = req.body;
  const f = req.file;

  try {
    const { rows } = await pool.query(
      `INSERT INTO files (user_id, case_id, name, s3_key, s3_url, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        req.user.id,
        case_id || null,
        f.originalname,
        f.key,                  // S3 key from multer-s3
        f.location,             // Public S3 URL from multer-s3
        f.mimetype,
        f.size,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB insert failed after upload' });
  }
});

// GET /api/files — list all files for this user
router.get('/', async (req, res) => {
  const { case_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM files
       WHERE user_id = $1 ${case_id ? 'AND case_id = $2' : ''}
       ORDER BY created_at DESC`,
      case_id ? [req.user.id, case_id] : [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/files/:id/download — generate a temporary signed URL (15 min)
router.get('/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'File not found' });

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key:    rows[0].s3_key,
      }),
      { expiresIn: 900 } // 15 minutes
    );

    res.json({ url, expires_in: 900 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate download link' });
  }
});

// DELETE /api/files/:id — delete from S3 and DB
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'File not found' });

    // Delete from S3
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key:    rows[0].s3_key,
    }));

    // Delete from DB
    await pool.query(`DELETE FROM files WHERE id = $1`, [req.params.id]);

    res.json({ message: 'File deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── FILE NOTES ───────────────────────────────────────────────────────────────

// GET /api/files/:id/notes
router.get('/:id/notes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT fn.* FROM file_notes fn
       JOIN files f ON f.id = fn.file_id
       WHERE fn.file_id = $1 AND f.user_id = $2
       ORDER BY fn.created_at ASC`,
      [req.params.id, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/files/:id/notes
router.post('/:id/notes', async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Note content is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO file_notes (file_id, user_id, content)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.user.id, content.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/files/:fileId/notes/:noteId
router.delete('/:fileId/notes/:noteId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM file_notes WHERE id = $1 AND user_id = $2`,
      [req.params.noteId, req.user.id]
    );
    res.json({ message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

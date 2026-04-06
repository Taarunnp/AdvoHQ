// config/s3.js — AWS S3 client setup
const { S3Client } = require('@aws-sdk/client-s3');
const multer        = require('multer');
const multerS3      = require('multer-s3');
const path          = require('path');

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Allowed MIME types for legal document uploads
const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp',
  'text/plain',
];

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    // Each file stored under: files/{userId}/{timestamp}-{original}
    key(req, file, cb) {
      const ext      = path.extname(file.originalname);
      const basename = path.basename(file.originalname, ext)
        .replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      const key = `files/${req.user.id}/${Date.now()}-${basename}${ext}`;
      cb(null, key);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB cap
  fileFilter(_req, file, cb) {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

module.exports = { s3, upload };

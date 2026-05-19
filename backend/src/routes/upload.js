const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const pool = require('../db');
const { uploadImage } = require('../storage/cloudinary');
const { analyzeOutfit } = require('../llm/pipeline');
const { requireAdminToken } = require('../middleware/auth');
const { enqueue, queueLength } = require('../queue');

const router = express.Router();
const upload = multer({ dest: '/tmp/ffe-uploads/' });

function fileHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// POST /api/admin/upload  (multipart: image OR images[])
router.post('/admin/upload', requireAdminToken, upload.array('image', 20), async (req, res, next) => {
  try {
    const files = req.files?.length ? req.files : req.file ? [req.file] : [];
    if (!files.length) return res.status(400).json({ error: 'No images provided' });

    const results = await Promise.all(files.map(async (file) => {
      const hash = fileHash(file.path);

      // Duplicate check
      const existing = await pool.query('SELECT id FROM outfits WHERE file_hash = $1', [hash]);
      if (existing.rows.length) {
        fs.unlink(file.path, () => {});
        return { duplicate: true, id: existing.rows[0].id, filename: file.originalname };
      }

      const { imageUrl, thumbUrl } = await uploadImage(file.path);
      fs.unlink(file.path, () => {});
      const { rows } = await pool.query(
        'INSERT INTO outfits (image_url, thumb_url, file_hash) VALUES ($1, $2, $3) RETURNING id',
        [imageUrl, thumbUrl, hash]
      );
      const outfitId = rows[0].id;

      // Add to sequential queue
      enqueue(() => analyzeOutfit(imageUrl, outfitId)).catch((err) =>
        console.error('queue analyzeOutfit failed', outfitId, err)
      );

      return { duplicate: false, id: outfitId, image_url: imageUrl, thumb_url: thumbUrl, status: 'pending', filename: file.originalname };
    }));

    res.status(201).json({ results, queue_length: queueLength() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

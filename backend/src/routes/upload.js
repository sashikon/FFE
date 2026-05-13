const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { uploadImage } = require('../storage/cloudinary');
const { analyzeOutfit } = require('../llm/pipeline');
const { requireAdminToken } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ dest: '/tmp/ffe-uploads/' });

// POST /api/admin/upload  (multipart: image)
router.post('/admin/upload', requireAdminToken, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    const { imageUrl, thumbUrl } = await uploadImage(req.file.path);

    const { rows } = await pool.query(
      'INSERT INTO outfits (image_url, thumb_url) VALUES ($1, $2) RETURNING id',
      [imageUrl, thumbUrl]
    );
    const outfitId = rows[0].id;

    // Fire-and-forget: LLM pipeline runs in background
    analyzeOutfit(imageUrl, outfitId).catch((err) =>
      console.error('analyzeOutfit failed', outfitId, err)
    );

    res.status(201).json({ id: outfitId, image_url: imageUrl, thumb_url: thumbUrl, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

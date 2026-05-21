const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pool = require('../db');
const { invalidate } = require('../cache');
const { analyzeOutfit } = require('../llm/pipeline');
const { enqueue } = require('../queue');
const { requireAdminToken } = require('../middleware/auth');
const { uploadImage } = require('../storage/cloudinary');

const upload = multer({ dest: '/tmp/ffe-uploads/' });

const router = express.Router();
router.use(requireAdminToken);

// GET /api/admin/outfits
router.get('/outfits', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.image_url, o.thumb_url, o.title, o.created_at,
              json_object_agg(t.lang, json_build_object('status', t.status, 'error_msg', t.error_msg, 'game_rows', t.game_rows))
                FILTER (WHERE t.lang IS NOT NULL) AS translations,
              COALESCE((
                SELECT json_agg(json_build_object('id', r.id, 'image_url', r.image_url, 'thumb_url', r.thumb_url))
                FROM outfit_renders r WHERE r.outfit_id = o.id
              ), '[]') AS renders
       FROM outfits o
       LEFT JOIN outfit_translations t ON t.outfit_id = o.id
       GROUP BY o.id
       ORDER BY o.created_at DESC`
    );
    res.json({ outfits: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/outfit/:id/renders — upload renders
router.post('/outfit/:id/renders', upload.array('render', 20), async (req, res, next) => {
  try {
    const { id } = req.params;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files provided' });

    const results = await Promise.all(files.map(async (file) => {
      const { imageUrl, thumbUrl } = await uploadImage(file.path);
      fs.unlink(file.path, () => {});
      const { rows } = await pool.query(
        'INSERT INTO outfit_renders (outfit_id, image_url, thumb_url) VALUES ($1, $2, $3) RETURNING id, image_url, thumb_url',
        [id, imageUrl, thumbUrl]
      );
      return rows[0];
    }));

    res.status(201).json({ renders: results });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/render/:renderId
router.delete('/render/:renderId', async (req, res, next) => {
  try {
    const { renderId } = req.params;
    await pool.query('DELETE FROM outfit_renders WHERE id = $1', [renderId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/outfit/:id
router.delete('/outfit/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM outfits WHERE id = $1', [id]);
    await invalidate(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/outfit/:id/retry — re-run LLM pipeline
router.post('/outfit/:id/retry', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT image_url FROM outfits WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    // Reset stuck translations so recoverPending / pipeline sets them fresh
    await pool.query(
      `UPDATE outfit_translations SET status = 'error', error_msg = 'manual retry'
       WHERE outfit_id = $1 AND status = 'pending'`,
      [id]
    );
    await invalidate(id);
    enqueue(() => analyzeOutfit(rows[0].image_url, id)).catch((err) =>
      console.error('retry analyzeOutfit failed', id, err)
    );

    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/outfit/:id/rows — manual edit of game rows
router.post('/outfit/:id/rows', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { lang, game_rows } = req.body;
    if (!lang || !Array.isArray(game_rows)) {
      return res.status(400).json({ error: 'lang and game_rows are required' });
    }

    await pool.query(
      `UPDATE outfit_translations SET game_rows = $1, status = 'ready'
       WHERE outfit_id = $2 AND lang = $3`,
      [JSON.stringify(game_rows), id, lang]
    );
    await invalidate(id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

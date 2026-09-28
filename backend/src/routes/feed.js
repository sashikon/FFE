const express = require('express');
const pool = require('../db');

const router = express.Router();

const LIMIT = 100; // Pinterest публикует до 200 пинов в сутки и берёт старое первым

// Что отдать в RSS: рендеры с написанным SEO и эскизы образов. Уже привязанные к пину
// или помеченные выгруженными не отдаём — они на Pinterest и так есть
const QUERIES = {
  renders: `
    SELECT r.id, r.image_url, r.pin_title AS title, r.pin_description AS description,
           r.created_at, r.outfit_id
    FROM outfit_renders r
    WHERE r.pin_title IS NOT NULL AND r.pin_title <> ''
      AND r.image_url IS NOT NULL
      AND r.pinterest_pin_id IS NULL
      AND r.pinterest_exported_at IS NULL
    ORDER BY r.created_at ASC
    LIMIT $1`,
  sketches: `
    SELECT o.id, o.image_url, o.title, NULL::text AS description, o.created_at, o.id AS outfit_id
    FROM outfits o
    WHERE o.image_url IS NOT NULL
      AND o.sketch_pin_id IS NULL
      AND o.pinterest_exported IS NOT TRUE
    ORDER BY o.created_at ASC
    LIMIT $1`,
};

// GET /api/pinterest-feed?kind=renders|sketches — сырьё для RSS, который собирает фронт
router.get('/pinterest-feed', async (req, res, next) => {
  try {
    const kind = QUERIES[req.query.kind] ? req.query.kind : 'renders';
    const limit = Math.min(LIMIT, Math.max(1, parseInt(req.query.limit, 10) || LIMIT));
    const { rows } = await pool.query(QUERIES[kind], [limit]);
    res.set('Cache-Control', 'public, max-age=900');
    res.json({ kind, items: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

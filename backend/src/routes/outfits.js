const express = require('express');
const pool = require('../db');
const { getGameRows } = require('../cache');

const router = express.Router();

// GET /api/outfits?lang=ru&page=1
router.get('/outfits', async (req, res, next) => {
  try {
    const lang = req.query.lang || 'ru';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT o.id, o.image_url, o.thumb_url, o.title, o.created_at,
              t.status
       FROM outfits o
       LEFT JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $1
       ORDER BY o.created_at DESC
       LIMIT $2 OFFSET $3`,
      [lang, limit, offset]
    );

    const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM outfits');
    const total = parseInt(countRows[0].count);

    res.json({ outfits: rows, total, page });
  } catch (err) {
    next(err);
  }
});

// GET /api/outfit/:id?lang=ru
router.get('/outfit/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const lang = req.query.lang || 'ru';

    const { rows } = await pool.query(
      'SELECT id, image_url, thumb_url, title, title_en FROM outfits WHERE id = $1',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const [svgResult, renderResult] = await Promise.all([
      pool.query(
        'SELECT id, label, label_en, svg_url, sort_order, is_wrong, wrong_reason FROM outfit_svg_layers WHERE outfit_id = $1 ORDER BY sort_order, created_at',
        [id]
      ),
      pool.query(
        'SELECT id, image_url, thumb_url FROM outfit_renders WHERE outfit_id = $1 ORDER BY RANDOM() LIMIT 1',
        [id]
      ),
    ]);

    const outfit = { ...rows[0], svg_layers: svgResult.rows, renders: renderResult.rows };

    // Try Redis cache first
    let gameRows = await getGameRows(id, lang);

    if (!gameRows) {
      const { rows: transRows } = await pool.query(
        'SELECT game_rows, status FROM outfit_translations WHERE outfit_id = $1 AND lang = $2',
        [id, lang]
      );
      if (transRows.length && transRows[0].status === 'ready') {
        gameRows = transRows[0].game_rows;
      }
    }

    if (!gameRows) {
      return res.status(202).json({ ...outfit, game_rows: null, status: 'pending' });
    }

    res.json({ ...outfit, game_rows: gameRows, status: 'ready' });
  } catch (err) {
    next(err);
  }
});

// GET /api/renders/random?exclude=:outfitId&count=3
router.get('/renders/random', async (req, res, next) => {
  try {
    const { exclude, count = '3' } = req.query;
    const { rows } = await pool.query(
      'SELECT id, image_url, thumb_url FROM outfit_renders WHERE outfit_id != $1 ORDER BY RANDOM() LIMIT $2',
      [exclude, Math.min(10, parseInt(count) || 3)]
    );
    res.json({ renders: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

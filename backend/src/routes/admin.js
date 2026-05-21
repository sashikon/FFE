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
      `SELECT o.id, o.image_url, o.thumb_url, o.title, o.created_at, o.file_hash,
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

// GET /api/admin/pinterest-export?lang=en&board=FFE
// Returns a ready-to-upload CSV file for Pinterest bulk pin creation.
// Uses first render from outfit_renders per outfit; falls back to image_url (sketch).
router.get('/pinterest-export', async (req, res, next) => {
  try {
    const lang  = req.query.lang  || 'en';
    const board = req.query.board || 'FFE';
    const BASE_URL = 'https://ffe-blush.vercel.app';
    const TITLE_MAX = 100;
    const DESC_MAX  = 500;

    const { rows } = await pool.query(
      `SELECT o.id, o.image_url, o.thumb_url, o.title,
              t.game_rows,
              (SELECT r.image_url FROM outfit_renders r WHERE r.outfit_id = o.id ORDER BY r.created_at DESC LIMIT 1) AS render_url
       FROM outfits o
       JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $1
       WHERE t.status = 'ready'
       ORDER BY o.created_at DESC`,
      [lang]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `No ready outfits for lang="${lang}"` });
    }

    function csvCell(v) {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n\r]/.test(s) ? `"${s}"` : s;
    }
    function csvRow(cells) { return cells.map(csvCell).join(','); }

    function buildDescription(gameRows) {
      if (!Array.isArray(gameRows) || !gameRows.length) return '';
      const themes = gameRows.map((r) => r.theme).filter(Boolean).join(' · ');
      const hook = lang === 'ru' ? 'Пять слоёв. Одно лишнее слово.' : 'Five layers. One odd word.';
      return `${hook} ${themes}`.slice(0, DESC_MAX);
    }

    function buildKeywords(gameRows) {
      const base = lang === 'ru'
        ? ['мода', 'образ', 'стиль', 'насмотренность']
        : ['fashion', 'outfit', 'style', 'fashion game', 'fashion literacy'];
      const words = new Set(base);
      for (const row of (gameRows || [])) {
        for (const opt of (row.options || [])) {
          if (opt && opt.length <= 30) words.add(opt.toLowerCase());
        }
      }
      return [...words].join(', ');
    }

    // Pinterest requires exact English column names regardless of interface language.
    // Thumbnail is only relevant for video pins — leave empty for image pins.
    const header = ['Title', 'Pinterest board', 'Media URL', 'Thumbnail', 'Description', 'Link', 'Publish date', 'Keywords'];
    const lines  = [csvRow(header)];

    for (const outfit of rows) {
      const gameRows    = outfit.game_rows || [];
      const title       = (outfit.title || (lang === 'ru' ? 'Читай образ' : 'Read this outfit')).slice(0, TITLE_MAX);
      const mediaUrl    = outfit.render_url || outfit.image_url;
      const description = buildDescription(gameRows);
      const keywords    = buildKeywords(gameRows);
      const link        = `${BASE_URL}/outfit/${outfit.id}?lang=${lang}`;

      // Thumbnail left blank — only required for video pins
      lines.push(csvRow([title, board, mediaUrl, '', description, link, '', keywords]));
    }

    // No BOM — Pinterest's parser doesn't strip it and reads first header as '﻿Title'
    // CRLF line endings per RFC 4180
    const csv = lines.join('\r\n');
    const filename = `pinterest_${lang}_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

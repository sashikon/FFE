const express = require('express');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { invalidate } = require('../cache');
const { analyzeOutfit } = require('../llm/pipeline');
const { uploadRender } = require('../storage/cloudinary');
const { enqueue } = require('../queue');
const { requireAdminToken } = require('../middleware/auth');

const upload = multer({ dest: '/tmp/ffe-uploads/' });

const router = express.Router();
router.use(requireAdminToken);

// GET /api/admin/outfits
router.get('/outfits', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.image_url, o.thumb_url, o.render_url, o.title, o.created_at,
              json_object_agg(t.lang, json_build_object('status', t.status, 'error_msg', t.error_msg, 'game_rows', t.game_rows))
                FILTER (WHERE t.lang IS NOT NULL) AS translations
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

// POST /api/admin/outfit/:id/render — attach AI render (file upload OR external URL)
router.post('/outfit/:id/render', upload.single('render'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check outfit exists
    const { rows } = await pool.query('SELECT id FROM outfits WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    let renderUrl = req.body?.render_url?.trim() || null;

    if (req.file) {
      // File uploaded — push to Cloudinary ffe/renders/
      const result = await uploadRender(req.file.path);
      fs.unlink(req.file.path, () => {});
      renderUrl = result.renderUrl;
    }

    if (!renderUrl) return res.status(400).json({ error: 'Provide render_url or upload a file' });

    await pool.query('UPDATE outfits SET render_url = $1 WHERE id = $2', [renderUrl, id]);
    res.json({ ok: true, render_url: renderUrl });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/outfit/:id/render — remove render
router.delete('/outfit/:id/render', async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE outfits SET render_url = NULL WHERE id = $1', [id]);
    res.json({ ok: true });
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
router.get('/pinterest-export', async (req, res, next) => {
  try {
    const lang  = req.query.lang  || 'en';
    const board = req.query.board || 'FFE';
    const BASE_URL = 'https://ffe-blush.vercel.app';
    const TITLE_MAX = 100;
    const DESC_MAX  = 500;

    const { rows } = await pool.query(
      `SELECT o.id, o.image_url, o.thumb_url, o.render_url, o.title,
              t.game_rows
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

    const header = ['Title', 'Pinterest board', 'Media URL', 'Thumbnail', 'Description', 'Link', 'Publish date', 'Keywords'];
    const lines  = [csvRow(header)];

    for (const outfit of rows) {
      const gameRows   = outfit.game_rows || [];
      const title      = (outfit.title || (lang === 'ru' ? 'Читай образ' : 'Read this outfit')).slice(0, TITLE_MAX);
      const mediaUrl   = outfit.render_url || outfit.image_url;
      const thumbnail  = outfit.thumb_url || '';
      const description = buildDescription(gameRows);
      const keywords   = buildKeywords(gameRows);
      const link       = `${BASE_URL}/outfit/${outfit.id}?lang=${lang}`;

      lines.push(csvRow([title, board, mediaUrl, thumbnail, description, link, '', keywords]));
    }

    const csv = lines.join('\n');
    const filename = `pinterest_${lang}_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // BOM for Excel/Sheets compatibility
  } catch (err) {
    next(err);
  }
});

module.exports = router;

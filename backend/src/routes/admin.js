const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pool = require('../db');
const { invalidate } = require('../cache');
const { analyzeOutfit } = require('../llm/pipeline');
const { analyzeAesthetics } = require('../llm/aesthetics');
const { enqueue } = require('../queue');
const { requireAdminToken } = require('../middleware/auth');
const Anthropic = require('@anthropic-ai/sdk');
const { uploadImage, uploadSvg } = require('../storage/cloudinary');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const upload = multer({ dest: '/tmp/ffe-uploads/' });

const router = express.Router();
router.use(requireAdminToken);

// GET /api/admin/outfits
router.get('/outfits', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.image_url, o.thumb_url, o.title, o.created_at, o.file_hash, o.pinterest_exported,
              json_object_agg(t.lang, json_build_object('status', t.status, 'error_msg', t.error_msg, 'game_rows', t.game_rows))
                FILTER (WHERE t.lang IS NOT NULL) AS translations,
              COALESCE((
                SELECT json_agg(json_build_object('id', r.id, 'image_url', r.image_url, 'thumb_url', r.thumb_url, 'aesthetics', r.aesthetics, 'pinterest_exported_at', r.pinterest_exported_at))
                FROM outfit_renders r WHERE r.outfit_id = o.id
              ), '[]') AS renders,
              COALESCE((
                SELECT json_agg(json_build_object('id', s.id, 'label', s.label, 'svg_url', s.svg_url, 'sort_order', s.sort_order, 'is_wrong', s.is_wrong, 'wrong_reason', s.wrong_reason)
                        ORDER BY s.sort_order, s.created_at)
                FROM outfit_svg_layers s WHERE s.outfit_id = o.id
              ), '[]') AS svg_layers
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

// POST /api/admin/outfit/:id/svg-layers/analyze — find wrong item via Claude
router.post('/outfit/:id/svg-layers/analyze', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [layersResult, transResult] = await Promise.all([
      pool.query(
        'SELECT id, label FROM outfit_svg_layers WHERE outfit_id = $1 AND label != \'\' ORDER BY sort_order, created_at',
        [id]
      ),
      pool.query(
        'SELECT lang, game_rows FROM outfit_translations WHERE outfit_id = $1 AND status = \'ready\'',
        [id]
      ),
    ]);

    const layers = layersResult.rows;
    if (layers.length < 2) return res.status(400).json({ error: 'Нужно минимум 2 слоя с названиями' });

    const trans = {};
    transResult.rows.forEach((r) => { trans[r.lang] = r.game_rows; });
    const gameRows = trans.ru || trans.en;
    if (!gameRows) return res.status(400).json({ error: 'Нет готового семиотического анализа образа' });

    const semiotics = gameRows.map((r) => {
      const wrong = r.correct || '';
      const rest = (r.options || []).filter((o) => o !== wrong).join(', ');
      return `${r.theme}: ${rest} (лишнее: ${wrong})`;
    }).join('\n');

    const itemList = layers.map((l) => l.label).join(', ');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: `Ты эксперт по fashion-семиотике. Твоя задача — найти предмет, который нарушает целостную систему кодов образа.

Правила:
- Оценивай предметы и аксессуары ТОЛЬКО в контексте общей эстетики, не по их бытовым ассоциациям
- Вечерние перчатки, оперные перчатки — классика драматического, готического, формального образа; они не лишние
- Корсеты, массивная обувь, сетчатые элементы — органичны в готике и авангарде
- Леггинсы, кроссовки, спортивные детали — ломают романтический или вечерний образ
- Лишний предмет — тот, чей код ПРОТИВОРЕЧИТ системе остальных, а не просто выглядит необычно
- Сначала определи тип образа по семиотике, потом ищи нарушителя`,
      messages: [{
        role: 'user',
        content: `Семиотика образа (слова, которые описывают его):\n${semiotics}\n\nПредметы в образе: ${itemList}\n\nКратко: что за образ по семиотике? Какой предмет из списка ломает эту систему?\nОтветь: сначала 1 строка рассуждения, затем JSON на новой строке:\n{"label":"точное название предмета из списка","reason":"1-2 предложения почему он лишний в контексте именно этого образа"}`,
      }],
    });

    let parsed;
    try {
      const text = response.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match[0]);
    } catch {
      return res.status(500).json({ error: 'Не удалось распарсить ответ Claude' });
    }

    const needle = parsed.label.toLowerCase();
    const wrongLayer = layers.find((l) => l.label.toLowerCase() === needle)
      || layers.find((l) => l.label.toLowerCase().includes(needle))
      || layers.find((l) => needle.includes(l.label.toLowerCase()))
      || layers.find((l) => l.label.toLowerCase().split(/\s+/).some((w) => w.length > 3 && needle.includes(w)));

    if (!wrongLayer) return res.status(400).json({
      error: `Claude назвал "${parsed.label}", не совпало ни с одной меткой (${layers.map((l) => l.label).join(', ')}) — отметь вручную кликом на предмет`,
    });

    await pool.query('UPDATE outfit_svg_layers SET is_wrong = FALSE WHERE outfit_id = $1', [id]);
    await pool.query(
      'UPDATE outfit_svg_layers SET is_wrong = TRUE, wrong_reason = $1 WHERE id = $2',
      [parsed.reason, wrongLayer.id]
    );

    res.json({ wrong_layer_id: wrongLayer.id, label: wrongLayer.label, reason: parsed.reason });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/outfit/:id/svg-layers — upload SVG layer files
router.post('/outfit/:id/svg-layers', upload.array('svg', 20), async (req, res, next) => {
  try {
    const { id } = req.params;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files provided' });

    const results = await Promise.all(files.map(async (file, i) => {
      const label = (Array.isArray(req.body.labels) ? req.body.labels[i] : req.body.labels) || file.originalname.replace(/\.svg$/i, '');
      const sortOrder = parseInt((Array.isArray(req.body.orders) ? req.body.orders[i] : req.body.orders) || '0') || i;
      const svgUrl = await uploadSvg(file.path);
      fs.unlink(file.path, () => {});
      const { rows } = await pool.query(
        'INSERT INTO outfit_svg_layers (outfit_id, label, svg_url, sort_order) VALUES ($1, $2, $3, $4) RETURNING id, label, svg_url, sort_order',
        [id, label, svgUrl, sortOrder]
      );
      return rows[0];
    }));

    res.status(201).json({ layers: results });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/svg-layer/:id — update label, sort_order, or is_wrong
router.patch('/svg-layer/:layerId', async (req, res, next) => {
  try {
    const { layerId } = req.params;
    const { label, sort_order, is_wrong } = req.body;
    if (is_wrong === true) {
      const { rows } = await pool.query('SELECT outfit_id FROM outfit_svg_layers WHERE id = $1', [layerId]);
      if (rows.length) await pool.query('UPDATE outfit_svg_layers SET is_wrong = FALSE WHERE outfit_id = $1', [rows[0].outfit_id]);
    }
    await pool.query(
      `UPDATE outfit_svg_layers SET
        label = COALESCE($1, label),
        sort_order = COALESCE($2, sort_order),
        is_wrong = COALESCE($3, is_wrong)
       WHERE id = $4`,
      [label ?? null, sort_order ?? null, is_wrong ?? null, layerId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/svg-layer/:id
router.delete('/svg-layer/:layerId', async (req, res, next) => {
  try {
    const { layerId } = req.params;
    await pool.query('DELETE FROM outfit_svg_layers WHERE id = $1', [layerId]);
    res.json({ ok: true });
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

// GET /api/admin/pinterest-preview?lang=en&new=true
// Returns JSON list of outfits (or renders) that would be included in a Pinterest export.
router.get('/pinterest-preview', async (req, res, next) => {
  try {
    const lang         = req.query.lang || 'en';
    const onlyNew      = req.query.new === 'true';
    const rendersOnly  = req.query.renders === 'true';

    if (rendersOnly) {
      // Per-render mode: one row per un-exported render
      const { rows } = await pool.query(
        `SELECT r.id, r.thumb_url AS render_thumb, r.image_url AS render_url,
                o.id AS outfit_id, o.thumb_url, o.image_url, o.title
         FROM outfit_renders r
         JOIN outfits o ON o.id = r.outfit_id
         JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $1
         WHERE t.status = 'ready'
           AND r.pinterest_exported_at IS NULL
         ORDER BY o.created_at DESC, r.created_at DESC`,
        [lang]
      );
      return res.json({ outfits: rows });
    }

    const { rows } = await pool.query(
      `SELECT o.id, o.thumb_url, o.image_url, o.title,
              (SELECT r.thumb_url FROM outfit_renders r WHERE r.outfit_id = o.id ORDER BY r.created_at DESC LIMIT 1) AS render_thumb,
              (SELECT r.image_url FROM outfit_renders r WHERE r.outfit_id = o.id ORDER BY r.created_at DESC LIMIT 1) AS render_url
       FROM outfits o
       JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $1
       WHERE t.status = 'ready'
         AND ($2 = false OR (o.pinterest_exported->$3) IS NULL)
       ORDER BY o.created_at DESC`,
      [lang, onlyNew, lang]
    );

    res.json({ outfits: rows });
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

    const onlyNew      = req.query.new === 'true';
    const rendersOnly  = req.query.renders === 'true';
    const ids          = req.query.ids ? req.query.ids.split(',').filter(Boolean) : null;

    let rows;

    if (rendersOnly) {
      // Per-render export: ids are render IDs
      const renderFilter = ids && ids.length ? ids : null;
      const result = await pool.query(
        `SELECT r.id AS render_id, r.image_url AS render_url, r.thumb_url AS render_thumb_url,
                o.id, o.image_url, o.thumb_url, o.title,
                t.game_rows, o.pinterest_exported
         FROM outfit_renders r
         JOIN outfits o ON o.id = r.outfit_id
         JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $1
         WHERE t.status = 'ready'
           AND r.pinterest_exported_at IS NULL
           AND ($2::uuid[] IS NULL OR r.id = ANY($2::uuid[]))
         ORDER BY o.created_at DESC, r.created_at DESC`,
        [lang, renderFilter]
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT o.id, o.image_url, o.thumb_url, o.title,
                t.game_rows,
                o.pinterest_exported,
                COALESCE(
                  (SELECT r.image_url FROM outfit_renders r WHERE r.outfit_id = o.id ORDER BY r.created_at DESC LIMIT 1),
                  o.image_url
                ) AS render_url,
                o.thumb_url AS render_thumb_url
         FROM outfits o
         JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $1
         WHERE t.status = 'ready'
           AND ($2 = false OR (o.pinterest_exported->$3) IS NULL)
           AND ($4::uuid[] IS NULL OR o.id = ANY($4::uuid[]))
         ORDER BY o.created_at DESC`,
        [lang, onlyNew, lang, ids]
      );
      rows = result.rows;
    }

    if (!rows.length) {
      return res.status(404).json({ error: `No ready outfits for lang="${lang}"` });
    }

    function csvCell(v) {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n\r]/.test(s) ? `"${s}"` : s;
    }
    function csvRow(cells) { return cells.map(csvCell).join(','); }

    function buildTitle(gameRows) {
      if (!Array.isArray(gameRows) || !gameRows.length) return null;

      const silhouette  = (gameRows[0]?.options || [])[0] || '';
      const assocRow    = gameRows.length > 4 ? gameRows[4] : gameRows[gameRows.length - 1];
      const association = (assocRow?.options || [])[0] || '';

      if (!silhouette && !association) return null;

      const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

      if (lang === 'ru') {
        // RU: «Ассоциация · Силуэт»
        return `${cap(association)} · ${silhouette}`.slice(0, TITLE_MAX);
      }

      // EN — collect all text for trend matching
      const allText = [];
      for (const row of gameRows) {
        for (const opt of (row.options || [])) if (opt) allText.push(opt.toLowerCase());
        if (row.theme) allText.push(row.theme.toLowerCase());
      }
      const has = terms => terms.some(m => allText.some(t => t.includes(m)));

      // Trending 2025 (Pinterest Predicts) — first match wins
      const trends = [
        { test: ['medieval', 'armor', 'chainmail'],              label: 'Medieval Core'       },
        { test: ['vamp', 'vampire', 'noir', 'dark academia'],    label: 'Vamp Romantic'       },
        { test: ['rococo', 'baroque', 'ornate', 'embroidered'],  label: 'Rococo'              },
        { test: ['fisherman', 'nautical', 'maritime', 'sailor'], label: 'Fisherman Aesthetic' },
        { test: ['moto', 'biker', 'motorcycle'],                 label: 'Moto Boho'           },
        { test: ['witchery', 'ethereal', 'mystical'],            label: 'Sea Witchery'        },
        { test: ['cherry', 'scarlet'],                           label: 'Cherry Coded'        },
        { test: ['korean', 'hanbok'],                            label: 'Korean Fashion'      },
        { test: ['boho', 'bohemian', 'western'],                 label: 'Boho'                },
        { test: ['y2k', 'retro', '2000s'],                       label: 'Y2K'                 },
        { test: ['preppy', 'ivy league', 'collegiate'],          label: 'Preppy'              },
        // gothic without medieval falls through as association ("gothic editorial")
        { test: ['gothic', 'couture', 'theatrical'],             label: 'Gothic Editorial'    },
      ];

      const trend = trends.find(({ test }) => has(test));

      if (trend) {
        // "Vamp Romantic Outfit · Fitted"
        return `${trend.label} Outfit · ${cap(silhouette)}`.slice(0, TITLE_MAX);
      }

      // No trend — use association with natural phrasing
      const assocLabels = {
        'cocktail':    'Cocktail Party',
        'gala':        'Gala Evening',
        'red carpet':  'Red Carpet',
        'redcarpet':   'Red Carpet',
        'evening':     'Evening',
        'night out':   'Night Out',
        'boardroom':   'Boardroom',
        'office':      'Office',
        'beach':       'Beach',
        'resort':      'Resort',
        'couture':     'Couture',
        'runway':      'Runway',
        'wedding':     'Wedding',
        'ceremony':    'Ceremony',
        'opera':       'Opera',
        'party':       'Party',
        'sportswear':  'Sporty',
        'streetwear':  'Streetwear',
      };
      const assocLabel = assocLabels[association.toLowerCase()] || cap(association);

      // "Cocktail Party Outfit · Fitted Midi"
      // Length hint: scan remaining options in the form row (row 0) for a length word
      const lengthWords  = new Set(['midi', 'maxi', 'mini', 'floor-length', 'cropped', 'long', 'short']);
      const formOptions  = (gameRows[0]?.options || []).slice(1);  // options after silhouette
      const lengthWord   = formOptions.find(o => o && lengthWords.has(o.toLowerCase())) || '';
      const lengthHint   = lengthWord ? ` ${cap(lengthWord)}` : '';

      return `${assocLabel} Outfit · ${cap(silhouette)}${lengthHint}`.slice(0, TITLE_MAX);
    }

    function buildDescription(gameRows) {
      if (!Array.isArray(gameRows) || !gameRows.length) return '';
      const themes = gameRows.map((r) => r.theme).filter(Boolean).join(' · ');
      const hook = lang === 'ru' ? 'Пять слоёв. Одно лишнее слово.' : 'Five layers. One odd word.';
      return `${hook} ${themes}`.slice(0, DESC_MAX);
    }

    function buildKeywords(gameRows) {
      const base = lang === 'ru'
        ? ['мода', 'образ', 'стиль', 'насмотренность', 'идеи образов', 'эстетика',
           'что одеть', 'осенняя мода', 'осенние образы', 'стили в одежде']
        : [
            // high-frequency discovery
            'outfit ideas', 'dress to impress', 'aesthetic clothes', 'cute outfit ideas',
            // style literacy
            'aesthetic outfits types', 'clothing style names aesthetic', 'style genres', 'fashion style quiz',
            // fall/seasonal — peaks annually, good to index year-round
            'fall fashion outfits', 'fall fashion trends', 'neutral palette outfit', 'cream aesthetic',
            // evergreen
            'fashion', 'outfit', 'style', 'fashion game', 'fashion literacy',
          ];

      const words = new Set(base);

      // Collect all option text + themes from game_rows for matching
      const allText = [];
      for (const row of (gameRows || [])) {
        for (const opt of (row.options || [])) {
          if (opt && opt.length <= 30) {
            words.add(opt.toLowerCase());
            allText.push(opt.toLowerCase());
          }
        }
        if (row.theme) allText.push(row.theme.toLowerCase());
      }

      // Trending 2025 (Pinterest Predicts) — added only when outfit content matches
      if (lang === 'en') {
        const trends = [
          { match: ['rococo', 'baroque', 'ornate', 'embroidered'],           add: ['rococo outfit'] },
          { match: ['medieval', 'gothic', 'armor', 'chainmail'],             add: ['medieval core'] },
          { match: ['fisherman', 'nautical', 'maritime', 'sailor'],          add: ['fisherman aesthetic'] },
          { match: ['moto', 'biker', 'motorcycle'],                          add: ['moto boho', 'moto boots'] },
          { match: ['boho', 'bohemian', 'festival', 'western'],              add: ['moto boho'] },
          { match: ['vamp', 'vampire', 'noir', 'dark academia'],             add: ['vamp romantic'] },
          { match: ['cherry', 'scarlet'],                                    add: ['cherry vibes', 'cherry coded'] },
          { match: ['sea', 'ocean', 'witchery', 'ethereal', 'mystical'],     add: ['sea witchery'] },
          { match: ['korea', 'korean', 'hanbok'],                            add: ['korean casual outfits'] },
          { match: ['baggy', 'wide-leg', 'wide leg'],                        add: ['baggy outfit ideas', 'baggy pants outfit'] },
          { match: ['y2k', 'retro', '2000s'],                                add: ['y2k winter jacket'] },
          { match: ['fur', 'shearling', 'teddy coat'],                       add: ['fur coat vintage'] },
          { match: ['vintage', 'thrift', 'secondhand'],                      add: ['dream thrift finds', 'vintage fall aesthetic'] },
          { match: ['preppy', 'ivy league', 'collegiate'],                   add: ["women's preppy outfits"] },
          { match: ['camel', 'tan', 'coffee', 'mocha', 'brown'],            add: ['coffee brown pants outfit'] },
          { match: ['puff sleeve', 'bubble', 'balloon sleeve'],              add: ['puff skirt outfit'] },
          { match: ['lace', 'corset'],                                       add: ['lace corset outfit'] },
          { match: ['leopard', 'animal print', 'cheetah'],                   add: ['leopard print jeans'] },
        ];

        for (const { match, add } of trends) {
          if (match.some(m => allText.some(t => t.includes(m)))) {
            for (const kw of add) words.add(kw);
          }
        }
      }

      return [...words].join(', ');
    }

    // Pinterest requires exact English column names regardless of interface language.
    // Thumbnail is only relevant for video pins — leave empty for image pins.
    const header = ['Title', 'Pinterest board', 'Media URL', 'Thumbnail', 'Description', 'Link', 'Publish date', 'Keywords'];
    const lines  = [csvRow(header)];

    // Pass 1: generate raw titles for every outfit
    const rawTitles = rows.map((outfit, i) => {
      const gameRows = outfit.game_rows || [];
      return (
        outfit.title ||
        buildTitle(gameRows) ||
        (lang === 'ru' ? `Образ ${i + 1}` : `Outfit ${i + 1}`)
      ).slice(0, TITLE_MAX);
    });

    // Deduplicate: when the same base title appears more than once, number all copies
    const titleFreq = new Map();
    for (const t of rawTitles) titleFreq.set(t, (titleFreq.get(t) || 0) + 1);
    const titleSeen = new Map();
    const finalTitles = rawTitles.map(t => {
      if (titleFreq.get(t) === 1) return t;               // unique — keep as-is
      const n = (titleSeen.get(t) || 0) + 1;
      titleSeen.set(t, n);
      return `${t.slice(0, TITLE_MAX - 4)} (${n})`;       // e.g. "One word out: … (2)"
    });

    // Pass 2: build CSV rows
    for (const [i, outfit] of rows.entries()) {
      const gameRows    = outfit.game_rows || [];
      const mediaUrl    = rendersOnly
        ? (outfit.render_url || outfit.image_url)   // specific render image
        : (outfit.render_url || outfit.image_url);  // best render or sketch
      const description = buildDescription(gameRows);
      const keywords    = buildKeywords(gameRows);
      const link        = `${BASE_URL}/outfit/${outfit.id}?lang=${lang}`;

      // Thumbnail left blank — only required for video pins
      lines.push(csvRow([finalTitles[i], board, mediaUrl, '', description, link, '', keywords]));
    }

    // No BOM — Pinterest's parser doesn't strip it and reads first header as '﻿Title'
    // CRLF line endings per RFC 4180
    const csv = lines.join('\r\n');
    const filename = `pinterest_${lang}_${rendersOnly ? '_renders' : ''}_${new Date().toISOString().slice(0, 10)}.csv`;

    // Mark exported items
    try {
      const now = new Date().toISOString();
      if (rendersOnly) {
        // Mark individual renders as exported
        const renderIds = rows.map((r) => r.render_id);
        await pool.query(
          'UPDATE outfit_renders SET pinterest_exported_at = $1 WHERE id = ANY($2::uuid[])',
          [now, renderIds]
        );
      } else {
        // Mark outfits as exported (sketch wave)
        const exportedIds = rows.map((r) => r.id);
        await pool.query(
          `UPDATE outfits
           SET pinterest_exported = COALESCE(pinterest_exported, '{}') || $1::jsonb
           WHERE id = ANY($2::uuid[])`,
          [JSON.stringify({ [lang]: now }), exportedIds]
        );
      }
    } catch (markErr) {
      console.error('Failed to mark pinterest export:', markErr);
      // non-fatal — still send the CSV
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/outfit/:id/pinterest-mark — manually mark/unmark Pinterest export
// body: { lang: 'en'|'ru', exported: true|false }
router.post('/outfit/:id/pinterest-mark', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { lang, exported } = req.body;
    if (!['en', 'ru'].includes(lang)) return res.status(400).json({ error: 'Invalid lang' });

    if (exported) {
      await pool.query(
        `UPDATE outfits
         SET pinterest_exported = COALESCE(pinterest_exported, '{}') || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ [lang]: new Date().toISOString() }), id]
      );
    } else {
      await pool.query(
        `UPDATE outfits
         SET pinterest_exported = COALESCE(pinterest_exported, '{}') - $1
         WHERE id = $2`,
        [lang, id]
      );
    }

    const { rows } = await pool.query('SELECT pinterest_exported FROM outfits WHERE id = $1', [id]);
    res.json({ pinterest_exported: rows[0]?.pinterest_exported ?? {} });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/render/:id/pinterest-mark — mark/unmark render as exported to Pinterest
// body: { exported: true|false }
router.post('/render/:id/pinterest-mark', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { exported } = req.body;
    const ts = exported ? new Date().toISOString() : null;
    const { rows } = await pool.query(
      'UPDATE outfit_renders SET pinterest_exported_at = $1 WHERE id = $2 RETURNING pinterest_exported_at',
      [ts, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ pinterest_exported_at: rows[0].pinterest_exported_at });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/render/:id/analyze — run aesthetics analysis on a single render
router.post('/render/:id/analyze', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT image_url FROM outfit_renders WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const aesthetics = await analyzeAesthetics(rows[0].image_url);
    await pool.query('UPDATE outfit_renders SET aesthetics = $1 WHERE id = $2', [JSON.stringify(aesthetics), id]);
    res.json({ aesthetics });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/coverage — all analyzed renders grouped for coverage board
router.get('/coverage', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.image_url, r.thumb_url, r.aesthetics,
              o.id AS outfit_id, o.title, o.thumb_url AS outfit_thumb
       FROM outfit_renders r
       JOIN outfits o ON o.id = r.outfit_id
       WHERE r.aesthetics IS NOT NULL
       ORDER BY o.created_at DESC`
    );
    res.json({ renders: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

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

    const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

    // ── Shared lookup tables ─────────────────────────────────────────────────
    // Trending 2025 aesthetics (Pinterest Predicts). First match wins.
    // Each entry has a title label and the Pinterest board it maps to.
    const TRENDS = [
      { test: ['medieval', 'armor', 'chainmail'],              label: 'Medieval Core',       board: 'Medieval Core Outfits'      },
      { test: ['vamp', 'vampire', 'noir', 'dark academia'],    label: 'Vamp Romantic',       board: 'Vamp Romantic Style'        },
      { test: ['rococo', 'baroque', 'ornate', 'embroidered'],  label: 'Rococo',              board: 'Rococo Fashion'             },
      { test: ['fisherman', 'nautical', 'maritime', 'sailor'], label: 'Fisherman Aesthetic', board: 'Fisherman Aesthetic'        },
      { test: ['moto', 'biker', 'motorcycle'],                 label: 'Moto Boho',           board: 'Moto Boho Outfits'          },
      { test: ['witchery', 'ethereal', 'mystical'],            label: 'Sea Witchery',        board: 'Sea Witchery Aesthetic'     },
      { test: ['cherry', 'scarlet'],                           label: 'Cherry Coded',        board: 'Cherry Coded Fashion'       },
      { test: ['korean', 'hanbok'],                            label: 'Korean Fashion',      board: 'Korean Fashion Inspiration' },
      { test: ['boho', 'bohemian', 'western'],                 label: 'Boho',                board: 'Boho Outfit Ideas'          },
      { test: ['y2k', 'retro', '2000s'],                       label: 'Y2K',                 board: 'Y2K Fashion'                },
      { test: ['preppy', 'ivy league', 'collegiate'],          label: 'Preppy',              board: 'Preppy Outfits'             },
      { test: ['gothic', 'theatrical'],                        label: 'Gothic Editorial',    board: 'Gothic Editorial Fashion'   },
    ];

    // Association → display label in title
    const ASSOC_LABELS = {
      'cocktail':   'Cocktail Party', 'gala':       'Gala Evening',
      'red carpet': 'Red Carpet',     'redcarpet':  'Red Carpet',
      'evening':    'Evening',        'night out':  'Night Out',
      'boardroom':  'Boardroom',      'office':     'Office',
      'beach':      'Beach',          'resort':     'Resort',
      'couture':    'Couture',        'runway':     'Runway',
      'wedding':    'Wedding',        'ceremony':   'Ceremony',
      'opera':      'Opera',          'party':      'Party',
      'sportswear': 'Sporty',         'streetwear': 'Streetwear',
    };

    // Association → Pinterest board name
    const ASSOC_BOARDS = lang === 'ru' ? {
      'коктейль':        'Образы на вечеринку',
      'красная дорожка': 'Красная дорожка',
      'вечерний выход':  'Вечерние образы',
      'офис':            'Офисный стиль',
      'пляж':            'Пляжный образ',
    } : {
      'cocktail':   'Cocktail Party Outfit Ideas',
      'gala':       'Gala & Formal Dresses',
      'red carpet': 'Red Carpet Evening Gowns',
      'redcarpet':  'Red Carpet Evening Gowns',
      'evening':    'Evening Outfit Ideas',
      'evening gala': 'Gala & Formal Dresses',
      'night out':  'Night Out Outfits',
      'boardroom':  'Boardroom & Office Fashion',
      'office':     'Boardroom & Office Fashion',
      'beach':      'Beach & Resort Outfits',
      'resort':     'Beach & Resort Outfits',
      'wedding':    'Wedding Guest Dresses',
      'ceremony':   'Wedding Guest Dresses',
      'couture':    'Runway & Couture Looks',
      'runway':     'Runway & Couture Looks',
      'streetwear': 'Streetwear Fashion',
      'sportswear': 'Sporty & Casual Outfits',
      'party':      'Party Outfit Ideas',
    };

    const FALLBACK_BOARD = lang === 'ru' ? 'Игра в моду · Найди лишнее' : 'Fashion Game · Find the Odd Word';

    // ── Shared helper: collect text + find matching trend ────────────────────
    function outfitContext(gameRows) {
      const allText = [];
      for (const row of (gameRows || [])) {
        for (const opt of (row.options || [])) if (opt) allText.push(opt.toLowerCase());
        if (row.theme) allText.push(row.theme.toLowerCase());
      }
      const has   = terms => terms.some(m => allText.some(t => t.includes(m)));
      const trend = TRENDS.find(({ test }) => has(test)) || null;
      const assocRow    = gameRows.length > 4 ? gameRows[4] : gameRows[gameRows.length - 1];
      const association = (assocRow?.options || [])[0] || '';
      const silhouette  = (gameRows[0]?.options || [])[0] || '';
      return { allText, has, trend, association, silhouette };
    }

    // ── Builder functions ────────────────────────────────────────────────────
    function buildTitle(gameRows) {
      if (!Array.isArray(gameRows) || !gameRows.length) return null;
      const { trend, association, silhouette } = outfitContext(gameRows);

      if (lang === 'ru') {
        return `${cap(association)} · ${silhouette}`.slice(0, TITLE_MAX) || null;
      }

      if (!silhouette && !association) return null;

      if (trend) {
        return `${trend.label} Outfit · ${cap(silhouette)}`.slice(0, TITLE_MAX);
      }

      const assocLabel = ASSOC_LABELS[association.toLowerCase()] || cap(association);
      // Length hint: look for a length word among the other form-row options
      const lengthWords = new Set(['midi', 'maxi', 'mini', 'floor-length', 'cropped', 'long', 'short']);
      const formOptions = (gameRows[0]?.options || []).slice(1);
      const lengthWord  = formOptions.find(o => o && lengthWords.has(o.toLowerCase())) || '';
      const lengthHint  = lengthWord ? ` ${cap(lengthWord)}` : '';

      return `${assocLabel} Outfit · ${cap(silhouette)}${lengthHint}`.slice(0, TITLE_MAX);
    }

    function buildBoard(gameRows) {
      if (!Array.isArray(gameRows) || !gameRows.length) return FALLBACK_BOARD;
      const { trend, association } = outfitContext(gameRows);
      if (lang === 'en' && trend) return trend.board;
      return ASSOC_BOARDS[association.toLowerCase()] || FALLBACK_BOARD;
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

      // Add all option words from game_rows
      for (const row of (gameRows || [])) {
        for (const opt of (row.options || [])) {
          if (opt && opt.length <= 30) words.add(opt.toLowerCase());
        }
      }

      // Trending 2025 keyword phrases — matched via shared outfitContext
      if (lang === 'en') {
        const { has } = outfitContext(gameRows);
        const kwTrends = [
          { match: ['rococo', 'baroque', 'ornate', 'embroidered'],        add: ['rococo outfit'] },
          { match: ['medieval', 'gothic', 'armor', 'chainmail'],          add: ['medieval core'] },
          { match: ['fisherman', 'nautical', 'maritime', 'sailor'],       add: ['fisherman aesthetic'] },
          { match: ['moto', 'biker', 'motorcycle'],                       add: ['moto boho', 'moto boots'] },
          { match: ['boho', 'bohemian', 'festival', 'western'],           add: ['moto boho'] },
          { match: ['vamp', 'vampire', 'noir', 'dark academia'],          add: ['vamp romantic'] },
          { match: ['cherry', 'scarlet'],                                 add: ['cherry vibes', 'cherry coded'] },
          { match: ['sea', 'ocean', 'witchery', 'ethereal', 'mystical'],  add: ['sea witchery'] },
          { match: ['korea', 'korean', 'hanbok'],                         add: ['korean casual outfits'] },
          { match: ['baggy', 'wide-leg', 'wide leg'],                     add: ['baggy outfit ideas', 'baggy pants outfit'] },
          { match: ['y2k', 'retro', '2000s'],                             add: ['y2k winter jacket'] },
          { match: ['fur', 'shearling', 'teddy coat'],                    add: ['fur coat vintage'] },
          { match: ['vintage', 'thrift', 'secondhand'],                   add: ['dream thrift finds', 'vintage fall aesthetic'] },
          { match: ['preppy', 'ivy league', 'collegiate'],                add: ["women's preppy outfits"] },
          { match: ['camel', 'tan', 'coffee', 'mocha', 'brown'],         add: ['coffee brown pants outfit'] },
          { match: ['puff sleeve', 'bubble', 'balloon sleeve'],           add: ['puff skirt outfit'] },
          { match: ['lace', 'corset'],                                    add: ['lace corset outfit'] },
          { match: ['leopard', 'animal print', 'cheetah'],                add: ['leopard print jeans'] },
        ];
        for (const { match, add } of kwTrends) {
          if (has(match)) for (const kw of add) words.add(kw);
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
      const mediaUrl    = outfit.render_url || outfit.image_url;
      const pinBoard    = buildBoard(gameRows);
      const description = buildDescription(gameRows);
      const keywords    = buildKeywords(gameRows);
      const link        = `${BASE_URL}/outfit/${outfit.id}?lang=${lang}`;

      // Thumbnail left blank — only required for video pins
      lines.push(csvRow([finalTitles[i], pinBoard, mediaUrl, '', description, link, '', keywords]));
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

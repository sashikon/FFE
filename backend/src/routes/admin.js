const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pool = require('../db');
const { invalidate } = require('../cache');
const { analyzeOutfit } = require('../llm/pipeline');
const { analyzeAesthetics, analyzeModel } = require('../llm/aesthetics');
const { enqueue } = require('../queue');
const { requireAdminToken } = require('../middleware/auth');
const Anthropic = require('@anthropic-ai/sdk');
const { fetchAllPins, fetchPinById, fetchPinAnalytics, getBoards, createPin, exchangeCodeForToken } = require('../pinterest');
const { uploadImage, uploadSvg, uploadScreenshot } = require('../storage/cloudinary');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const upload = multer({ dest: '/tmp/ffe-uploads/' });

const router = express.Router();

// ─── Pinterest OAuth — must be registered BEFORE requireAdminToken ────────────

const PINTEREST_REDIRECT = 'https://ffe-production.up.railway.app/api/admin/pinterest-callback';
const PINTEREST_APP_ID   = process.env.PINTEREST_APP_ID || '1584485';

router.get('/pinterest-auth', (req, res) => {
  // ?debug=1 — show what redirect URI we send (for troubleshooting)
  if (req.query.debug) return res.json({ redirect_uri: PINTEREST_REDIRECT, app_id: PINTEREST_APP_ID });
  const url = new URL('https://www.pinterest.com/oauth/');
  url.searchParams.set('client_id', PINTEREST_APP_ID);
  url.searchParams.set('redirect_uri', PINTEREST_REDIRECT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'boards:read,pins:write,pins:read,user_accounts:read');
  url.searchParams.set('state', 'ffe-admin');
  res.redirect(url.toString());
});

router.get('/pinterest-callback', async (req, res, next) => {
  try {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`Pinterest OAuth error: ${error}`);
    if (!code)  return res.status(400).send('Missing code');
    const tokens = await exchangeCodeForToken(code, PINTEREST_REDIRECT);
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Pinterest OAuth</title>
<style>body{font-family:monospace;background:#111;color:#eee;padding:2rem;max-width:700px;margin:auto}
pre{background:#222;padding:1rem;border-radius:8px;word-break:break-all;white-space:pre-wrap}
h2{color:#e60023}.note{color:#aaa;font-size:.85rem;margin-top:1rem}</style></head><body>
<h2>✅ Pinterest OAuth успешен</h2>
<p>Скопируй <strong>access_token</strong> в Railway → Variables → <code>PINTEREST_ACCESS_TOKEN</code>:</p>
<pre>${tokens.access_token}</pre>
<p>Refresh token (сохрани на случай обновления):</p>
<pre>${tokens.refresh_token || '—'}</pre>
<p class="note">Срок действия: ${Math.round((tokens.expires_in || 0) / 86400)} дней.</p>
</body></html>`);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
router.use(requireAdminToken);

// GET /api/admin/outfits
router.get('/outfits', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.image_url, o.thumb_url, o.title, o.title_en, o.created_at, o.file_hash, o.pinterest_exported, o.sketch_pin_id, o.sketch_pin_analytics, o.sketch_pin_analytics_updated_at,
              json_object_agg(t.lang, json_build_object('status', t.status, 'error_msg', t.error_msg, 'game_rows', t.game_rows))
                FILTER (WHERE t.lang IS NOT NULL) AS translations,
              COALESCE((
                SELECT json_agg(json_build_object('id', r.id, 'image_url', r.image_url, 'thumb_url', r.thumb_url, 'aesthetics', r.aesthetics, 'pinterest_exported_at', r.pinterest_exported_at, 'pin_title', r.pin_title, 'pin_description', r.pin_description, 'pinterest_pin_id', r.pinterest_pin_id, 'pinterest_analytics', r.pinterest_analytics, 'pinterest_analytics_updated_at', r.pinterest_analytics_updated_at, 'model_appearance', r.model_appearance))
                FROM outfit_renders r WHERE r.outfit_id = o.id
              ), '[]') AS renders,
              COALESCE((
                SELECT json_agg(json_build_object('id', s.id, 'label', s.label, 'label_en', s.label_en, 'svg_url', s.svg_url, 'sort_order', s.sort_order, 'is_wrong', s.is_wrong, 'wrong_reason', s.wrong_reason, 'wrong_reason_en', s.wrong_reason_en, 'wrong_source', s.wrong_source)
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

    const [layersResult, transResult, outfitResult] = await Promise.all([
      pool.query(
        'SELECT id, label, svg_url FROM outfit_svg_layers WHERE outfit_id = $1 AND label != \'\' ORDER BY sort_order, created_at',
        [id]
      ),
      pool.query(
        'SELECT lang, game_rows FROM outfit_translations WHERE outfit_id = $1 AND status = \'ready\'',
        [id]
      ),
      pool.query('SELECT image_url FROM outfits WHERE id = $1', [id]),
    ]);

    // exclude full-outfit summary SVGs (single-word labels like "образ")
    const SUMMARY_LABELS = new Set(['образ', 'образ вечерний', 'outfit', 'look', 'total']);
    const layers = layersResult.rows.filter((l) => !SUMMARY_LABELS.has(l.label.toLowerCase()));
    if (layers.length < 2) return res.status(400).json({ error: 'Нужно минимум 2 слоя с названиями (не считая сводного «образа»)' });

    const trans = {};
    transResult.rows.forEach((r) => { trans[r.lang] = r.game_rows; });
    const gameRows = trans.ru || trans.en;
    if (!gameRows) return res.status(400).json({ error: 'Нет готового семиотического анализа образа' });

    const semiotics = gameRows.map((r) => {
      const wrong = r.correct || '';
      const rest = (r.options || []).filter((o) => o !== wrong).join(', ');
      return `${r.theme}: ${rest} (лишнее в образе: ${wrong})`;
    }).join('\n');

    // Vision: send only the raster sketch — it shows the real outfit composition
    const outfitImageUrl = outfitResult.rows[0]?.image_url;
    if (!outfitImageUrl) return res.status(400).json({ error: 'Нет растрового эскиза образа' });

    const sketchUrl = outfitImageUrl.replace('/upload/', '/upload/w_700/');
    const itemList = layers.map((l) => l.label).join(', ');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: `Ты эксперт-стилист. Смотришь на иллюстрацию образа и список предметов, которые к нему относятся. Один предмет в списке — лишний: это либо другой вариант того же предмета (другой крой, другая деталь), либо предмет из другой эстетики.

Правила:
- Доверяй тому, что ВИДИШЬ на эскизе: силуэт, детали, пропорции, характер кроя
- Сравни каждое название из списка с тем что нарисовано — что из этого ты НЕ видишь на эскизе или видишь в другом варианте?
- Если два названия одной категории (юбка / юбка-2) — лишняя та, чей вариант не совпадает с нарисованным
- Называй предмет ТОЧНО как он записан в списке`,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Эскиз образа:' },
          { type: 'image', source: { type: 'url', url: sketchUrl } },
          {
            type: 'text',
            text: `Список предметов к этому образу: ${itemList}\n\nЧто ты видишь на эскизе? Какой предмет из списка не совпадает с нарисованным — или представлен в другом варианте?\nСначала 1-2 строки наблюдений, затем JSON:\n{"label":"точное название из списка","reason":"1-2 предложения — что конкретно не совпадает с эскизом"}`,
          },
        ],
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

    await pool.query('UPDATE outfit_svg_layers SET is_wrong = FALSE, wrong_source = NULL WHERE outfit_id = $1', [id]);
    await pool.query(
      "UPDATE outfit_svg_layers SET is_wrong = TRUE, wrong_reason = $1, wrong_source = 'ai' WHERE id = $2",
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

// GET /api/admin/svg-layers/library — all unique SVG items across all outfits
router.get('/svg-layers/library', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (s.svg_url) s.id, s.label, s.svg_url, o.title AS outfit_title
       FROM outfit_svg_layers s
       JOIN outfits o ON o.id = s.outfit_id
       WHERE s.label != '' AND s.label NOT IN ('образ', 'образ вечерний', 'outfit', 'look')
       ORDER BY s.svg_url, s.label, s.created_at DESC`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/outfit/:id/svg-layers/from-library — add existing SVG without re-upload
router.post('/outfit/:id/svg-layers/from-library', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { svg_url, label } = req.body;
    if (!svg_url || !label) return res.status(400).json({ error: 'svg_url and label required' });
    const { rows } = await pool.query(
      'INSERT INTO outfit_svg_layers (outfit_id, label, svg_url, sort_order) VALUES ($1, $2, $3, 0) RETURNING id, label, svg_url, sort_order, is_wrong, wrong_reason',
      [id, label, svg_url]
    );
    res.status(201).json({ layer: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/svg-layer/:id — update label, sort_order, is_wrong, wrong_reason, wrong_source
router.patch('/svg-layer/:layerId', async (req, res, next) => {
  try {
    const { layerId } = req.params;
    const { label, label_en, sort_order, is_wrong, wrong_reason, wrong_reason_en, wrong_source } = req.body;
    if (is_wrong === true) {
      const { rows } = await pool.query('SELECT outfit_id FROM outfit_svg_layers WHERE id = $1', [layerId]);
      if (rows.length) await pool.query('UPDATE outfit_svg_layers SET is_wrong = FALSE, wrong_source = NULL WHERE outfit_id = $1', [rows[0].outfit_id]);
    }
    await pool.query(
      `UPDATE outfit_svg_layers SET
        label = COALESCE($1, label),
        label_en = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE label_en END,
        sort_order = COALESCE($3, sort_order),
        is_wrong = COALESCE($4, is_wrong),
        wrong_reason = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE wrong_reason END,
        wrong_reason_en = CASE WHEN $6::text IS NOT NULL THEN $6 ELSE wrong_reason_en END,
        wrong_source = CASE WHEN $7::text IS NOT NULL THEN $7 WHEN $4 = false THEN NULL ELSE wrong_source END
       WHERE id = $8`,
      [label ?? null, label_en ?? null, sort_order ?? null, is_wrong ?? null, wrong_reason ?? null, wrong_reason_en ?? null, wrong_source ?? null, layerId]
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

// POST /api/admin/outfit/:id/svg-layers/translate — Claude Haiku translates labels + wrong_reason to EN
router.post('/outfit/:id/svg-layers/translate', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      'SELECT id, label, wrong_reason FROM outfit_svg_layers WHERE outfit_id = $1 AND label != \'\' ORDER BY sort_order, created_at',
      [id]
    );
    if (!rows.length) return res.json({ ok: true, count: 0 });

    const labelList = rows.map((r, i) => `${i + 1}. ${r.label}`).join('\n');
    const wrongLayer = rows.find(r => r.wrong_reason);

    const [labelMsg, reasonMsg] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Translate these Russian fashion item names to concise English (2-4 words max each). Return ONLY a JSON array of strings in the same order, no extra text.\n\n${labelList}`,
        }],
      }),
      wrongLayer ? anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `Translate this Russian fashion explanation to English. Keep it concise and clear (1-2 sentences). Return only the translation, no extra text.\n\n${wrongLayer.wrong_reason}`,
        }],
      }) : Promise.resolve(null),
    ]);

    const raw = labelMsg.content[0].text.trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: 'Parse error', raw });
    const translations = JSON.parse(match[0]);

    for (let i = 0; i < rows.length; i++) {
      const en = translations[i];
      if (en) await pool.query('UPDATE outfit_svg_layers SET label_en = $1 WHERE id = $2', [en, rows[i].id]);
    }

    if (wrongLayer && reasonMsg) {
      const reasonEn = reasonMsg.content[0].text.trim();
      await pool.query('UPDATE outfit_svg_layers SET wrong_reason_en = $1 WHERE id = $2', [reasonEn, wrongLayer.id]);
    }

    const { rows: updated } = await pool.query(
      'SELECT id, label_en, wrong_reason_en FROM outfit_svg_layers WHERE outfit_id = $1 ORDER BY sort_order, created_at',
      [id]
    );
    res.json({ ok: true, count: rows.length, layers: updated });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/outfit/:id/title — save title (and optional title_en)
router.patch('/outfit/:id/title', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, title_en } = req.body;
    await pool.query(
      `UPDATE outfits SET
        title    = CASE WHEN $1::text IS NOT NULL THEN $1 ELSE title END,
        title_en = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE title_en END
       WHERE id = $3`,
      [title ?? null, title_en ?? null, id]
    );
    res.json({ ok: true, title: title ?? null, title_en: title_en ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/outfit/:id/generate-title — generate RU title via Claude from game_rows
router.post('/outfit/:id/generate-title', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { lang = 'ru' } = req.body;
    const { rows } = await pool.query(
      `SELECT game_rows FROM outfit_translations WHERE outfit_id = $1 AND lang = $2 AND status = 'ready'`,
      [id, lang]
    );
    if (!rows.length || !rows[0].game_rows) return res.status(400).json({ error: 'No game data' });

    const rounds = rows[0].game_rows;

    let prompt, field;
    if (lang === 'en') {
      const context = rounds.map((r) => `Theme: ${r.theme}. Explanation: ${r.explanation}`).join('\n');
      prompt = `Based on this outfit description, create a short English title (2–4 words) for a gallery card. Style it like a fashion editorial title. Only the title, no quotes or explanation.\n\n${context}`;
      field = 'title_en';
    } else {
      const context = rounds.map((r) => `Тема: ${r.theme}. Объяснение: ${r.explanation}`).join('\n');
      prompt = `На основе описания образа придумай короткое название (2–4 слова) для карточки в галерее моды.

Правила:
- Только реально существующие русские слова — никаких неологизмов и словообразований вроде «вечерность», «готичность», «минималистность»
- Стиль: редакционный заголовок — прилагательное + существительное, или существительное + существительное в родительном падеже
- Примеры хороших названий: «Готический корсет», «Чёрный минимализм», «Образ семидесятых», «Вечерний силуэт», «Буфы и тюль»
- Только само название, без кавычек, без пояснений

${context}`;
      field = 'title';
    }

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    });

    const title = msg.content[0].text.trim().replace(/^["«»"]+|["«»"]+$/g, '');
    await pool.query(`UPDATE outfits SET ${field} = $1 WHERE id = $2`, [title, id]);
    res.json({ [field]: title });
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
                r.pin_title,
                o.id AS outfit_id, o.thumb_url, o.image_url, o.title, o.title_en
         FROM outfit_renders r
         JOIN outfits o ON o.id = r.outfit_id
         WHERE r.pinterest_exported_at IS NULL
         ORDER BY o.created_at DESC, r.created_at DESC`,
        []
      );
      return res.json({ outfits: rows });
    }

    const { rows } = await pool.query(
      `SELECT o.id, o.thumb_url, o.image_url, o.title, o.title_en,
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
                r.pin_title, r.pin_description,
                o.id, o.image_url, o.thumb_url, o.title, o.title_en,
                t.game_rows, o.pinterest_exported
         FROM outfit_renders r
         JOIN outfits o ON o.id = r.outfit_id
         LEFT JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $1 AND t.status = 'ready'
         WHERE r.pinterest_exported_at IS NULL
           AND ($2::uuid[] IS NULL OR r.id = ANY($2::uuid[]))
         ORDER BY o.created_at DESC, r.created_at DESC`,
        [lang, renderFilter]
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT o.id, o.image_url, o.thumb_url, o.title, o.title_en,
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

      // Find silhouette/form row by theme name, fallback to first row
      const formThemes = ['form', 'silhouette', 'форма', 'силуэт', 'shape'];
      const formRow = gameRows.find(r => formThemes.some(k => r.theme?.toLowerCase().includes(k))) || gameRows[0];
      const silhouette  = (formRow?.options || [])[0] || '';
      // Association row: last row, or row with theme containing 'assoc'/'code'/'смысл'
      const assocThemes = ['association', 'code', 'смысл', 'ассоц', 'meaning'];
      const assocRow = gameRows.find(r => assocThemes.some(k => r.theme?.toLowerCase().includes(k)))
        || (gameRows.length > 4 ? gameRows[4] : gameRows[gameRows.length - 1]);
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
    // Priority: SEO pin_title → localised outfit title → computed → fallback
    const rawTitles = rows.map((outfit, i) => {
      const gameRows = outfit.game_rows || [];
      const localisedTitle = lang === 'en' ? (outfit.title_en || outfit.title) : outfit.title;
      return (
        outfit.pin_title ||
        localisedTitle ||
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
      return `${t.slice(0, TITLE_MAX - 4)} — ${n}`;       // e.g. "Title — 2"
    });

    // Pass 2: build CSV rows
    // Track duplicate outfit links — Pinterest rejects pins with identical destination URLs
    const linkSeen = new Map();
    for (const [i, outfit] of rows.entries()) {
      const gameRows    = outfit.game_rows || [];
      const mediaUrl    = rendersOnly
        ? (outfit.render_url || outfit.image_url)   // specific render image
        : (outfit.render_url || outfit.image_url);  // best render or sketch
      const description = outfit.pin_description || buildDescription(gameRows);
      const keywords    = buildKeywords(gameRows);
      const seen        = (linkSeen.get(outfit.id) || 0) + 1;
      linkSeen.set(outfit.id, seen);
      const link        = seen > 1 ? `${BASE_URL}/outfit/${outfit.id}?v=${seen}` : `${BASE_URL}/outfit/${outfit.id}`;

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

    const [aesthetics, model_appearance] = await Promise.all([
      analyzeAesthetics(rows[0].image_url),
      analyzeModel(rows[0].image_url),
    ]);
    await pool.query(
      'UPDATE outfit_renders SET aesthetics = $1, model_appearance = $2 WHERE id = $3',
      [JSON.stringify(aesthetics), JSON.stringify(model_appearance), id]
    );
    res.json({ aesthetics, model_appearance });
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

// GET /api/admin/mechanic-screenshots — all screenshots grouped by mechanic_key
router.get('/mechanic-screenshots', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, mechanic_key, image_url, created_at FROM mechanic_screenshots ORDER BY mechanic_key, created_at'
    );
    const grouped = {};
    rows.forEach((r) => {
      if (!grouped[r.mechanic_key]) grouped[r.mechanic_key] = [];
      grouped[r.mechanic_key].push(r);
    });
    res.json({ screenshots: grouped });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/mechanic-screenshots — upload screenshot for a mechanic
router.post('/mechanic-screenshots', upload.single('image'), async (req, res, next) => {
  try {
    const { mechanic_key } = req.body;
    if (!mechanic_key || !req.file) return res.status(400).json({ error: 'mechanic_key and image required' });
    const imageUrl = await uploadScreenshot(req.file.path);
    fs.unlink(req.file.path, () => {});
    const { rows } = await pool.query(
      'INSERT INTO mechanic_screenshots (mechanic_key, image_url) VALUES ($1, $2) RETURNING id, mechanic_key, image_url, created_at',
      [mechanic_key, imageUrl]
    );
    res.status(201).json({ screenshot: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/mechanic-screenshot/:id
router.delete('/mechanic-screenshot/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM mechanic_screenshots WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/render/:id/generate-seo — Claude generates Pinterest SEO title+description
router.post('/render/:id/generate-seo', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { lang = 'en' } = req.body;

    // Load render + outfit data
    const { rows } = await pool.query(
      `SELECT r.id, r.aesthetics, r.pin_title, r.pin_description,
              r.image_url AS render_url,
              o.title AS outfit_title,
              t.game_rows
       FROM outfit_renders r
       JOIN outfits o ON o.id = r.outfit_id
       LEFT JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $2
       WHERE r.id = $1`,
      [id, lang]
    );
    if (!rows.length) return res.status(404).json({ error: 'Render not found' });
    const render = rows[0];

    const aestheticsTop = render.aesthetics?.top?.slice(0, 3).map(a => a.name).join(', ') || '';
    const gameRows = render.game_rows || [];
    const themes = gameRows.map(r => r.theme).filter(Boolean).join(', ');
    const gameKeywords = gameRows.flatMap(r => r.options || []).filter(Boolean).slice(0, 20).join(', ');
    const outfitTitle = render.outfit_title || '';
    const renderUrl = render.render_url || null;

    // Inject audience analytics strategy if available
    const { rows: stratRows } = await pool.query(
      'SELECT prompt_injection, top_keywords FROM pinterest_seo_strategy WHERE id = 1'
    );
    const strategyInjection = stratRows[0]?.prompt_injection || null;
    const topKw = stratRows[0]?.top_keywords ? JSON.parse(stratRows[0].top_keywords) : null;
    const stratKeywords = topKw ? topKw.slice(0, 8).map(k => k.keyword).join(', ') : null;

    const isRu = lang === 'ru';

    const prompt = isRu
      ? `Ты Pinterest SEO-специалист для русской аудитории. Создай title и description для пина.

Данные об образе:
- Название: ${outfitTitle || '—'}
- Pinterest-эстетики: ${aestheticsTop || '—'}
- Темы игры: ${themes || '—'}
- Ключевые слова образа: ${gameKeywords || '—'}

Правила:
- Title: 2-6 слов, максимум 100 символов. Пример: «Романтичный образ с буфами»
- Description: 1-3 предложения, 80-150 символов. Начни с эмоции или визуального образа, заверши призывом или вопросом. Упомяни конкретные элементы.
- Оба поля — на русском, без хэштегов
- Ориентируйся на запросы: «идеи образов», «что одеть», «стиль», «эстетика одежды»

Верни строго JSON: {"title": "...", "description": "..."}`
      : `You are a Pinterest SEO specialist. Generate a pin title and description optimized for 2025 Pinterest search.

Outfit data:
- Outfit title: ${outfitTitle || '—'}
- Top Pinterest aesthetics: ${aestheticsTop || '—'}
- Game semantic layers: ${themes || '—'}
- Keywords from outfit: ${gameKeywords || '—'}

Rules:
- Title: 3-7 words, max 100 chars. Include a trending aesthetic if applicable. Examples: "Vamp Romantic Outfit Ideas", "Cocktail Party Dress Inspo"
- Description: 2-3 sentences, 100-200 chars. Lead with a visual or emotional hook, name specific garment details, end with a call to action or question.
- No hashtags in either field
- Target keywords: outfit ideas, dress to impress, aesthetic clothes, style inspo, fashion
${strategyInjection ? `\nAudience analytics insights (use these to refine keyword selection):\n${strategyInjection}` : ''}
${stratKeywords ? `- High-value keywords from your audience data: ${stratKeywords}` : ''}

Return strict JSON only: {"title": "...", "description": "..."}`;

    // Build message content — attach render image if available so Claude sees actual colors
    const userContent = renderUrl
      ? [
          { type: 'image', source: { type: 'url', url: renderUrl } },
          { type: 'text', text: prompt },
        ]
      : prompt;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: userContent }],
    });

    const raw = msg.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'Parse error', raw });
    const { title, description } = JSON.parse(match[0]);

    await pool.query(
      'UPDATE outfit_renders SET pin_title = $1, pin_description = $2 WHERE id = $3',
      [title || null, description || null, id]
    );

    res.json({ ok: true, pin_title: title, pin_description: description });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/render/:id/seo — save pin_title / pin_description manually
router.patch('/render/:id/seo', async (req, res, next) => {
  try {
    const { pin_title, pin_description } = req.body;
    await pool.query(
      'UPDATE outfit_renders SET pin_title = $1, pin_description = $2 WHERE id = $3',
      [pin_title ?? null, pin_description ?? null, req.params.id]
    );
    res.json({ ok: true, pin_title, pin_description });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/pinterest/fetch-sketch-analytics
// Fetches 90-day analytics for all outfits that have a sketch_pin_id.
router.post('/pinterest/fetch-sketch-analytics', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sketch_pin_id FROM outfits WHERE sketch_pin_id IS NOT NULL`
    );
    let updated = 0;
    for (const outfit of rows) {
      const analytics = await fetchPinAnalytics(outfit.sketch_pin_id);
      if (analytics) {
        await pool.query(
          `UPDATE outfits SET sketch_pin_analytics = $1, sketch_pin_analytics_updated_at = now() WHERE id = $2`,
          [JSON.stringify(analytics), outfit.id]
        );
        updated++;
      }
    }
    res.json({ ok: true, total: rows.length, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/outfit/:id/sketch-pin-id — manually set sketch Pinterest pin
router.patch('/outfit/:id/sketch-pin-id', async (req, res, next) => {
  try {
    const { sketch_pin_id } = req.body;
    await pool.query(
      'UPDATE outfits SET sketch_pin_id = $1 WHERE id = $2',
      [sketch_pin_id || null, req.params.id]
    );
    res.json({ ok: true, sketch_pin_id });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/render/:id/pin-id — manually set pinterest_pin_id
router.patch('/render/:id/pin-id', async (req, res, next) => {
  try {
    const { pinterest_pin_id } = req.body;
    await pool.query(
      'UPDATE outfit_renders SET pinterest_pin_id = $1 WHERE id = $2',
      [pinterest_pin_id || null, req.params.id]
    );
    res.json({ ok: true, pinterest_pin_id });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/pinterest/import-pins
// One-shot: accepts parsed pin data from Pinterest archive HTML, saves to DB.
// { pins: [{ pin_id, board, outfit_id }] }
router.post('/pinterest/import-pins', async (req, res, next) => {
  try {
    const { pins } = req.body;
    if (!Array.isArray(pins)) return res.status(400).json({ error: 'pins array required' });

    let sketchUpdated = 0, renderUpdated = 0;

    for (const pin of pins) {
      if (pin.board === 'Fashion sketch') {
        const r = await pool.query(
          'UPDATE outfits SET sketch_pin_id = $1 WHERE id = $2',
          [pin.pin_id, pin.outfit_id]
        );
        if (r.rowCount > 0) sketchUpdated++;
      } else if (pin.board !== 'Collage Item Pins') {
        const r = await pool.query(
          `UPDATE outfit_renders SET pinterest_pin_id = $1
           WHERE id = (SELECT id FROM outfit_renders WHERE outfit_id = $2 ORDER BY created_at DESC LIMIT 1)`,
          [pin.pin_id, pin.outfit_id]
        );
        if (r.rowCount > 0) renderUpdated++;
      }
    }

    res.json({ ok: true, sketch_updated: sketchUpdated, render_updated: renderUpdated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/pinterest/pin/:id — debug: see raw pin data
router.get('/pinterest/pin/:id', async (req, res, next) => {
  try {
    const pin = await fetchPinById(req.params.id);
    res.json(pin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/pinterest/sync
// Accepts { pin_ids: string[] } from CSV, fetches each pin individually to get link,
// matches link to outfit, saves pin_id to renders.
router.post('/pinterest/sync', async (req, res, next) => {
  try {
    const { pin_ids } = req.body;
    if (!Array.isArray(pin_ids) || !pin_ids.length) {
      return res.status(400).json({ error: 'pin_ids array required' });
    }

    const uuidRe = /\/outfit\/([0-9a-f-]{36})/i;
    const matched = [];
    const errors = [];

    for (const pinId of pin_ids) {
      try {
        const pin = await fetchPinById(pinId);
        const link = pin.link || '';
        const m = link.match(uuidRe);
        if (!m) continue;
        const outfitId = m[1];

        const { rows } = await pool.query(
          `SELECT r.id FROM outfit_renders r
           WHERE r.outfit_id = $1
           ORDER BY r.created_at DESC LIMIT 1`,
          [outfitId]
        );

        if (rows.length) {
          await pool.query(
            'UPDATE outfit_renders SET pinterest_pin_id = $1 WHERE id = $2',
            [pinId, rows[0].id]
          );
          matched.push({ render_id: rows[0].id, pin_id: pinId, outfit_id: outfitId });
        }
      } catch (e) {
        errors.push({ pin_id: pinId, error: e.message });
      }
    }

    res.json({ ok: true, total_pins: pin_ids.length, matched: matched.length, items: matched, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/pinterest/fetch-analytics
// Fetches 90-day analytics for all renders that have a pinterest_pin_id.
router.post('/pinterest/fetch-analytics', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, pinterest_pin_id FROM outfit_renders
       WHERE pinterest_pin_id IS NOT NULL
       ORDER BY created_at DESC`
    );

    let updated = 0;
    let lastError = null;
    for (const render of rows) {
      const analytics = await fetchPinAnalytics(render.pinterest_pin_id).catch(e => { lastError = e.message; return null; });
      if (analytics) {
        await pool.query(
          `UPDATE outfit_renders
           SET pinterest_analytics = $1, pinterest_analytics_updated_at = now()
           WHERE id = $2`,
          [JSON.stringify(analytics), render.id]
        );
        updated++;
      }
    }

    res.json({ ok: true, total: rows.length, updated, last_error: lastError });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/pinterest-boards — list boards
router.get('/pinterest-boards', requireAdminToken, async (req, res, next) => {
  try {
    const boards = await getBoards();
    res.json({ boards });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/pinterest-post-renders — post selected renders as pins
// body: { ids: [renderUUID, ...], board_id: "...", lang: "en" }
router.post('/pinterest-post-renders', requireAdminToken, async (req, res, next) => {
  try {
    const { ids, board_id, lang = 'en' } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'ids required' });
    if (!board_id)    return res.status(400).json({ error: 'board_id required' });

    const BASE_URL = 'https://ffe-blush.vercel.app';
    const TITLE_MAX = 100;
    const DESC_MAX  = 500;

    const { rows } = await pool.query(
      `SELECT r.id AS render_id, r.image_url AS render_url,
              r.pin_title, r.pin_description,
              o.id AS outfit_id, o.title, o.title_en
       FROM outfit_renders r
       JOIN outfits o ON o.id = r.outfit_id
       WHERE r.id = ANY($1::uuid[])`,
      [ids]
    );

    const results = [];
    let failed = 0;
    for (const row of rows) {
      try {
        const title = (row.pin_title ||
          (lang === 'en' ? row.title_en || row.title : row.title) ||
          'FFE Outfit').slice(0, TITLE_MAX);
        const description = (row.pin_description || '').slice(0, DESC_MAX);
        const link = `${BASE_URL}/outfit/${row.outfit_id}`;

        const pin = await createPin({ boardId: board_id, title, description, imageUrl: row.render_url, link });

        await pool.query(
          `UPDATE outfit_renders
           SET pinterest_exported_at = now(), pinterest_pin_id = $1
           WHERE id = $2`,
          [pin.id, row.render_id]
        );
        results.push({ render_id: row.render_id, pin_id: pin.id, ok: true });
      } catch (e) {
        failed++;
        results.push({ render_id: row.render_id, ok: false, error: e.message });
      }
    }

    res.json({ ok: true, posted: results.filter(r => r.ok).length, failed, results });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PINTEREST AUDIENCE ANALYTICS — CSV Import & SEO Strategy
// ═══════════════════════════════════════════════════════════════════════════

const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Analyse CSV text with Claude and return structured insights
async function analyseCsvWithClaude(csvText, fileName) {
  // Truncate to ~3 KB — keeps headers + first rows, avoids unescaped quote issues in large CSVs
  const preview = csvText.length > 3000 ? csvText.slice(0, 3000) + '\n... (truncated)' : csvText;

  const prompt = `You are a Pinterest SEO and analytics strategist for a fashion AI game (FFE — Fashion Experience Education). Analyse this Pinterest Analytics CSV export and extract actionable SEO insights.

File name: ${fileName}
CSV content:
\`\`\`
${preview}
\`\`\`

CRITICAL: Return ONLY valid JSON. All string values must have internal quotes escaped as \". No unescaped newlines inside strings. No trailing commas. Exact shape:
{
  "report_type": "audience_insights" | "top_pins" | "overview" | "search_terms" | "unknown",
  "date_from": "YYYY-MM-DD or null",
  "date_to": "YYYY-MM-DD or null",
  "summary": "2-3 sentences describing what this report shows",
  "audience": [{"interest": "...", "affinity": "high|medium|low"}],
  "top_keywords": [{"keyword": "...", "score": 1-10}],
  "opportunities": [{"topic": "...", "reason": "..."}],
  "recommended_keywords": [{"keyword": "...", "score": 1-10, "reason": "..."}],
  "strategy_contribution": "One paragraph: what this data tells us about what Pinterest pin titles should contain for FFE content. Focus on SEO keywords, audience affinities, and content gaps.",
  "strategy_notes": "2-3 actionable bullet points for improving pin performance"
}

Guidelines:
- recommended_keywords should be 10-20 specific phrases good for Pinterest title SEO
- Focus on fashion/outfit/aesthetic keywords that match the audience data
- For top_pins reports: extract which title patterns performed best
- For search_terms: those ARE the keywords — prioritise them highest`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON: ' + raw.slice(0, 200));

  // Try direct parse first; if it fails, sanitise common Claude output issues
  try {
    return JSON.parse(match[0]);
  } catch {
    // Remove control characters and unescaped newlines inside string values
    const cleaned = match[0]
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')   // control chars
      .replace(/(?<=":[\s]*"[^"\\]*?)(\r?\n)(?=[^"]*?")/g, ' ') // bare newlines inside strings
      .replace(/([^\\])"(\s*[:,\]}])/g, '$1"$2');             // stray unescaped quotes before delimiters
    return JSON.parse(cleaned);
  }
}

// Synthesise a combined strategy from all stored report insights
async function synthesiseSeoStrategy(pool) {
  const { rows } = await pool.query(
    `SELECT insights, strategy_contribution, imported_at, report_type
     FROM pinterest_audience_reports
     ORDER BY imported_at DESC LIMIT 10`
  );
  if (!rows.length) return null;

  const digests = rows.map((r, i) =>
    `[Report ${i + 1} — ${r.report_type} — ${r.imported_at?.toISOString?.()?.slice(0, 10)}]\n${r.strategy_contribution || JSON.stringify(r.insights?.summary)}`
  ).join('\n\n');

  const prompt = `You are a Pinterest SEO strategist. Below are analytics digests from ${rows.length} Pinterest Analytics reports for FFE, a fashion AI game.

${digests}

Synthesise a combined Pinterest SEO strategy. Return ONLY valid JSON:
{
  "top_keywords": [{"keyword": "...", "score": 1-10, "sources": ["report_type..."]}],
  "audience_affinities": [{"interest": "...", "affinity": "high|medium|low"}],
  "opportunities": [{"topic": "...", "reason": "..."}],
  "strategy_notes": "3-5 bullet points as plain text",
  "prompt_injection": "A concise text block (max 200 chars) to inject into Claude's pin title generation prompt. Format: 'Audience top interests: X, Y, Z. High-value keywords: A, B, C. Trending: D, E.'"
}

top_keywords should have 15-25 entries, sorted by score descending.`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Strategy synthesis failed');
  return { ...JSON.parse(match[0]), report_count: rows.length };
}

// POST /api/admin/pinterest-audience/import — upload Pinterest Analytics CSV
router.post('/pinterest-audience/import', uploadCsv.single('csv'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const csvText = req.file.buffer.toString('utf-8');
    const fileName = req.file.originalname;

    const analysis = await analyseCsvWithClaude(csvText, fileName);

    const { rows } = await pool.query(
      `INSERT INTO pinterest_audience_reports
         (file_name, report_type, date_from, date_to, raw_csv, insights, strategy_contribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, imported_at`,
      [
        fileName,
        analysis.report_type || 'unknown',
        analysis.date_from || null,
        analysis.date_to   || null,
        csvText,
        JSON.stringify(analysis),
        analysis.strategy_contribution || null,
      ]
    );
    const { id, imported_at } = rows[0];

    // Re-synthesise strategy from all reports
    const strategy = await synthesiseSeoStrategy(pool);
    if (strategy) {
      await pool.query(
        `INSERT INTO pinterest_seo_strategy (id, updated_at, report_count, top_keywords, audience_affinities, opportunities, prompt_injection, strategy_notes)
         VALUES (1, now(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           updated_at = now(), report_count = $1,
           top_keywords = $2, audience_affinities = $3, opportunities = $4,
           prompt_injection = $5, strategy_notes = $6`,
        [
          strategy.report_count,
          JSON.stringify(strategy.top_keywords),
          JSON.stringify(strategy.audience_affinities),
          JSON.stringify(strategy.opportunities),
          strategy.prompt_injection,
          strategy.strategy_notes,
        ]
      );
    }

    res.json({ ok: true, id, imported_at, analysis, strategy });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/pinterest-audience — list reports + current strategy
router.get('/pinterest-audience', async (req, res, next) => {
  try {
    const { rows: reports } = await pool.query(
      `SELECT id, imported_at, file_name, report_type, date_from, date_to,
              insights->'summary' AS summary,
              insights->'recommended_keywords' AS recommended_keywords
       FROM pinterest_audience_reports
       ORDER BY imported_at DESC LIMIT 20`
    );
    const { rows: strat } = await pool.query(
      `SELECT updated_at, report_count, top_keywords, audience_affinities, opportunities, prompt_injection, strategy_notes
       FROM pinterest_seo_strategy WHERE id = 1`
    );
    res.json({ reports, strategy: strat[0] || null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/pinterest-audience/:id — delete one report + re-synthesise
router.delete('/pinterest-audience/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM pinterest_audience_reports WHERE id = $1', [req.params.id]);
    const strategy = await synthesiseSeoStrategy(pool);
    if (strategy) {
      await pool.query(
        `INSERT INTO pinterest_seo_strategy (id, updated_at, report_count, top_keywords, audience_affinities, opportunities, prompt_injection, strategy_notes)
         VALUES (1, now(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           updated_at = now(), report_count = $1,
           top_keywords = $2, audience_affinities = $3, opportunities = $4,
           prompt_injection = $5, strategy_notes = $6`,
        [strategy.report_count, JSON.stringify(strategy.top_keywords), JSON.stringify(strategy.audience_affinities), JSON.stringify(strategy.opportunities), strategy.prompt_injection, strategy.strategy_notes]
      );
    } else {
      await pool.query('DELETE FROM pinterest_seo_strategy WHERE id = 1');
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const pool = require('../db');
const { uploadVisual, deleteImage } = require('../storage/cloudinary');
const { requireAdminToken } = require('../middleware/auth');
const { generateVisualSeo } = require('../llm/visualSeo');

const router = express.Router();
const upload = multer({ dest: '/tmp/ffe-uploads/' });

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// Типы композиции приходят и строкой JSON (из формы), и массивом (из JSON-запроса)
function parseCompositions(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { list = raw.split(','); }
  }
  if (!Array.isArray(list)) return [];
  const clean = list.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  return [...new Set(clean)].slice(0, 12);
}

const text = (v, max) => String(v ?? '').trim().slice(0, max);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Из каких визуалов собран коллаж: строка JSON из формы, только настоящие id
function parseIds(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter((id) => UUID_RE.test(id)))].slice(0, 20);
}

// Загруженная SEO-стратегия (сводка по CSV аналитики Pinterest), если она есть
async function loadStrategy() {
  try {
    const { rows } = await pool.query(
      'SELECT updated_at, report_count, top_keywords, prompt_injection FROM pinterest_seo_strategy WHERE id = 1'
    );
    const st = rows[0];
    if (!st || (!st.prompt_injection && !(st.top_keywords || []).length)) return null;
    return st;
  } catch {
    return null; // таблицы может не быть на свежей базе
  }
}

// GET /api/admin/visuals?composition=диагональ — визуалы и счётчики по типам
router.get('/admin/visuals', requireAdminToken, async (req, res, next) => {
  try {
    const composition = text(req.query.composition, 80).toLowerCase();
    // Название образа нужно, чтобы на карточке было видно, откуда взят эскиз или рендер
    const { rows } = await pool.query(
      `SELECT v.*, COALESCE(o.title, ro.title) AS outfit_title,
              CASE WHEN v.render_id IS NOT NULL THEN 'render' WHEN v.outfit_id IS NOT NULL THEN 'sketch' ELSE 'upload' END AS origin
       FROM visuals v
       LEFT JOIN outfits o ON o.id = v.outfit_id
       LEFT JOIN outfit_renders r ON r.id = v.render_id
       LEFT JOIN outfits ro ON ro.id = r.outfit_id
       WHERE $1 = '' OR $1 = ANY(v.compositions)
       ORDER BY v.created_at DESC`,
      [composition]
    );
    const counts = await pool.query(`
      SELECT c AS name, COUNT(*)::int AS count
      FROM visuals, unnest(compositions) AS c
      GROUP BY c ORDER BY count DESC, c
    `);
    const total = await pool.query('SELECT COUNT(*)::int AS n FROM visuals');
    const strategy = await loadStrategy();
    res.json({
      visuals: rows,
      compositions: counts.rows,
      total: total.rows[0].n,
      seo_strategy: strategy ? { updated_at: strategy.updated_at, report_count: strategy.report_count } : null,
    });
  } catch (err) {
    next(err);
  }
});

// Взять в коллекцию уже имеющиеся эскизы образов и рендеры, не загружая картинки заново.
// picks: [{ outfit_id }] — эскиз образа, [{ render_id }] — рендер
async function addPicks(picks, compositions, note) {
  const results = [];
  for (const pick of picks.slice(0, 100)) {
    const renderId = pick?.render_id ? String(pick.render_id) : null;
    const outfitId = !renderId && pick?.outfit_id ? String(pick.outfit_id) : null;
    if (!renderId && !outfitId) continue;
    const src = renderId
      ? await pool.query('SELECT id, outfit_id, image_url, COALESCE(thumb_url, image_url) AS thumb_url FROM outfit_renders WHERE id::text = $1', [renderId])
      : await pool.query('SELECT id, image_url, COALESCE(thumb_url, image_url) AS thumb_url FROM outfits WHERE id::text = $1', [outfitId]);
    if (!src.rows.length) { results.push({ missing: true, render_id: renderId, outfit_id: outfitId }); continue; }
    const row = src.rows[0];
    const existing = renderId
      ? await pool.query('SELECT id FROM visuals WHERE render_id = $1', [row.id])
      : await pool.query('SELECT id FROM visuals WHERE outfit_id = $1 AND render_id IS NULL', [row.id]);
    if (existing.rows.length) { results.push({ duplicate: true, id: existing.rows[0].id }); continue; }
    const { rows } = await pool.query(
      `INSERT INTO visuals (image_url, thumb_url, outfit_id, render_id, compositions, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [row.image_url, row.thumb_url, renderId ? row.outfit_id : row.id, renderId ? row.id : null, compositions, note]
    );
    results.push({ duplicate: false, visual: rows[0] });
  }
  return results;
}

// POST /api/admin/visuals — файлы (multipart, поле image), { url } или { picks } в JSON
router.post('/admin/visuals', requireAdminToken, upload.array('image', 20), async (req, res, next) => {
  try {
    const compositions = parseCompositions(req.body.compositions);
    const note = text(req.body.note, 2000);
    const sourceUrl = text(req.body.source_url, 1000);
    const files = req.files || [];
    const url = text(req.body.url, 2000);
    const collageOf = parseIds(req.body.collage_of);

    if (Array.isArray(req.body.picks)) {
      if (!req.body.picks.length) return res.status(400).json({ error: 'Ничего не выбрано' });
      return res.status(201).json({ results: await addPicks(req.body.picks, compositions, note) });
    }

    if (!files.length && !url) return res.status(400).json({ error: 'Нужен файл или ссылка на картинку' });
    if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Ссылка должна начинаться с http' });

    const insert = async (img, hash) => {
      const { rows } = await pool.query(
        `INSERT INTO visuals (image_url, thumb_url, public_id, file_hash, compositions, note, source_url, collage_of)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [img.imageUrl, img.thumbUrl, img.publicId, hash, compositions, note, sourceUrl || (url && !files.length ? url : ''), collageOf.length ? collageOf : null]
      );
      return rows[0];
    };

    const results = [];
    for (const file of files) {
      const hash = fileHash(file.path);
      const existing = await pool.query('SELECT id FROM visuals WHERE file_hash = $1', [hash]);
      if (existing.rows.length) {
        fs.unlink(file.path, () => {});
        results.push({ duplicate: true, id: existing.rows[0].id, filename: file.originalname });
        continue;
      }
      try {
        const img = await uploadVisual(file.path);
        results.push({ duplicate: false, visual: await insert(img, hash) });
      } finally {
        fs.unlink(file.path, () => {});
      }
    }
    if (url && !files.length) {
      // Cloudinary сам скачивает картинку по ссылке; повтор той же ссылки ловим по source_url
      const existing = await pool.query('SELECT id FROM visuals WHERE source_url = $1', [url]);
      if (existing.rows.length) {
        results.push({ duplicate: true, id: existing.rows[0].id });
      } else {
        let img;
        try {
          img = await uploadVisual(url);
        } catch (err) {
          return res.status(400).json({ error: `Не получилось скачать картинку по ссылке: ${err.message}` });
        }
        results.push({ duplicate: false, visual: await insert(img, null) });
      }
    }

    res.status(201).json({ results });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/visuals/:id — поменять типы композиции, заметку, источник
router.patch('/admin/visuals/:id', requireAdminToken, async (req, res, next) => {
  try {
    const sets = [];
    const vals = [];
    if (req.body.compositions !== undefined) { vals.push(parseCompositions(req.body.compositions)); sets.push(`compositions = $${vals.length}`); }
    if (req.body.note !== undefined) { vals.push(text(req.body.note, 2000)); sets.push(`note = $${vals.length}`); }
    if (req.body.source_url !== undefined) { vals.push(text(req.body.source_url, 1000)); sets.push(`source_url = $${vals.length}`); }
    if (req.body.seo_title !== undefined) { vals.push(text(req.body.seo_title, 100)); sets.push(`seo_title = $${vals.length}`); }
    if (req.body.seo_title_alt !== undefined) { vals.push(text(req.body.seo_title_alt, 100)); sets.push(`seo_title_alt = $${vals.length}`); }
    // Снять отметку «выгружено в Pinterest», чтобы визуал снова попал в экспорт
    if (req.body.pinterest_exported === false) sets.push('pinterest_exported_at = NULL');
    if (req.body.seo_description !== undefined) { vals.push(text(req.body.seo_description, 500)); sets.push(`seo_description = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Нечего менять' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE visuals SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Визуал не найден' });
    res.json({ visual: rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/visuals/:id/generate-seo { lang: 'ru'|'en', use_strategy: bool }
// ИИ составляет заголовок, запасной заголовок и описание пина; результат сразу сохраняется
router.post('/admin/visuals/:id/generate-seo', requireAdminToken, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Визуал не найден' });
    const lang = req.body.lang === 'en' ? 'en' : 'ru';
    const { rows } = await pool.query('SELECT * FROM visuals WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Визуал не найден' });
    const visual = rows[0];

    // Что внутри коллажа: названия образов и эстетики рендеров помогают точнее назвать вещи
    let sources = [];
    if (visual.collage_of?.length) {
      const src = await pool.query(
        `SELECT v.id, v.compositions, v.note,
                CASE WHEN v.render_id IS NOT NULL THEN 'render' WHEN v.outfit_id IS NOT NULL THEN 'sketch' ELSE 'upload' END AS origin,
                COALESCE(o.title, ro.title) AS outfit_title, r.aesthetics
         FROM visuals v
         LEFT JOIN outfits o ON o.id = v.outfit_id
         LEFT JOIN outfit_renders r ON r.id = v.render_id
         LEFT JOIN outfits ro ON ro.id = r.outfit_id
         WHERE v.id = ANY($1)`,
        [visual.collage_of]
      );
      const byId = new Map(src.rows.map((r) => [r.id, r]));
      sources = visual.collage_of.map((id) => byId.get(id)).filter(Boolean).map((r) => ({
        ...r,
        aesthetics: r.aesthetics?.top?.slice(0, 3).map((a) => a.name).join(', ') || '',
      }));
    }

    let strategy = null;
    if (req.body.use_strategy) {
      strategy = await loadStrategy();
      if (!strategy) return res.status(400).json({ error: 'SEO-стратегия не загружена: сначала загрузите CSV аналитики Pinterest на вкладке «SEO» в разделе «Образы»' });
    }

    let seo;
    try {
      seo = await generateVisualSeo({ visual, sources, strategy, lang });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }

    const upd = await pool.query(
      `UPDATE visuals SET seo_title = $1, seo_title_alt = $2, seo_description = $3, seo_lang = $4, seo_with_strategy = $5
       WHERE id = $6 RETURNING *`,
      [seo.title, seo.title_alt, seo.description, lang, Boolean(strategy), visual.id]
    );
    res.json({ visual: upd.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/visuals/:id — удалить из базы и из Cloudinary
router.delete('/admin/visuals/:id', requireAdminToken, async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM visuals WHERE id = $1 RETURNING public_id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Визуал не найден' });
    if (rows[0].public_id) {
      deleteImage(rows[0].public_id).catch((e) => console.error('delete visual image failed', e));
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

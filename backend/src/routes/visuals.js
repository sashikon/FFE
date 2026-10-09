const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const pool = require('../db');
const { uploadVisual, deleteImage } = require('../storage/cloudinary');
const { requireAdminToken } = require('../middleware/auth');

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
    res.json({ visuals: rows, compositions: counts.rows, total: total.rows[0].n });
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

    if (Array.isArray(req.body.picks)) {
      if (!req.body.picks.length) return res.status(400).json({ error: 'Ничего не выбрано' });
      return res.status(201).json({ results: await addPicks(req.body.picks, compositions, note) });
    }

    if (!files.length && !url) return res.status(400).json({ error: 'Нужен файл или ссылка на картинку' });
    if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Ссылка должна начинаться с http' });

    const insert = async (img, hash) => {
      const { rows } = await pool.query(
        `INSERT INTO visuals (image_url, thumb_url, public_id, file_hash, compositions, note, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [img.imageUrl, img.thumbUrl, img.publicId, hash, compositions, note, sourceUrl || (url && !files.length ? url : '')]
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

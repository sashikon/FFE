const pool = require('./db');

// Экспорт визуалов из «Композиций» (прежде всего коллажей) в тот же CSV для массовой загрузки
// пинов в Pinterest, что и у образов: те же колонки, та же доска по умолчанию.
// В экспорт идут только визуалы с SEO-разметкой на нужном языке

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE_URL = 'https://ffe-blush.vercel.app';
const RU_BASE_KEYWORDS = ['мода', 'образ', 'стиль', 'идеи образов', 'композиция', 'насмотренность'];
const EN_BASE_KEYWORDS = ['outfit ideas', 'fashion', 'style inspo', 'aesthetic outfits', 'fashion composition'];

// Ссылка пина: страница первого образа из коллажа, иначе главная. Параметр c делает ссылки
// разными — Pinterest отклоняет пины с одинаковой ссылкой в одном файле
const QUERY = `
  SELECT v.id, v.image_url, v.thumb_url, v.compositions, v.seo_title, v.seo_description, v.seo_lang,
         (SELECT COALESCE(s.outfit_id, r.outfit_id)
            FROM unnest(v.collage_of) WITH ORDINALITY AS c(id, pos)
            JOIN visuals s ON s.id = c.id
            LEFT JOIN outfit_renders r ON r.id = s.render_id
           WHERE COALESCE(s.outfit_id, r.outfit_id) IS NOT NULL
           ORDER BY c.pos LIMIT 1) AS link_outfit_id
  FROM visuals v
  WHERE v.seo_title IS NOT NULL AND v.seo_title <> ''
    AND v.seo_lang = $1
    AND v.pinterest_exported_at IS NULL
    AND ($2::uuid[] IS NULL OR v.id = ANY($2::uuid[]))
  ORDER BY v.created_at DESC`;

function cleanIds(raw) {
  if (!raw) return null;
  const ids = String(raw).split(',').filter((id) => UUID_RE.test(id));
  return ids.length ? ids : [];
}

// Для окна экспорта: что будет выгружено (то же, что в CSV)
async function previewVisuals(lang) {
  const { rows } = await pool.query(QUERY, [lang, null]);
  return rows.map((v) => ({
    id: v.id,
    thumb_url: v.thumb_url,
    image_url: v.image_url,
    pin_title: v.seo_title,
  }));
}

// Сколько размечено на другом языке и потому в этот экспорт не попадёт — чтобы окно могло подсказать
async function otherLangCount(lang) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM visuals
     WHERE seo_title IS NOT NULL AND seo_title <> '' AND seo_lang IS DISTINCT FROM $1 AND pinterest_exported_at IS NULL`,
    [lang]
  );
  return rows[0].n;
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

async function strategyKeywords() {
  try {
    const { rows } = await pool.query('SELECT top_keywords FROM pinterest_seo_strategy WHERE id = 1');
    return (rows[0]?.top_keywords || []).slice(0, 8).map((k) => k.keyword).filter(Boolean);
  } catch {
    return [];
  }
}

// Возвращает { csv, count } или null, если выгружать нечего. Выгруженное помечается
async function exportVisualsCsv({ lang, ids, board }) {
  const idList = cleanIds(ids);
  if (idList && !idList.length) return null;
  const { rows } = await pool.query(QUERY, [lang, idList]);
  if (!rows.length) return null;

  const stratKw = lang === 'en' ? await strategyKeywords() : [];
  const header = ['Title', 'Pinterest board', 'Media URL', 'Thumbnail', 'Description', 'Link', 'Publish date', 'Keywords'];
  const lines = [header.map(csvCell).join(',')];
  for (const v of rows) {
    const link = v.link_outfit_id
      ? `${BASE_URL}/outfit/${v.link_outfit_id}?c=${v.id.slice(0, 8)}`
      : `${BASE_URL}/?c=${v.id.slice(0, 8)}`;
    const keywords = [...new Set([...(v.compositions || []), ...(lang === 'ru' ? RU_BASE_KEYWORDS : EN_BASE_KEYWORDS), ...stratKw])].join(', ');
    lines.push([v.seo_title.replace(/\s+/g, ' ').trim().slice(0, 100), board, v.image_url, '', (v.seo_description || '').replace(/\s+/g, ' ').trim().slice(0, 500), link, '', keywords].map(csvCell).join(','));
  }

  try {
    await pool.query('UPDATE visuals SET pinterest_exported_at = NOW() WHERE id = ANY($1::uuid[])', [rows.map((v) => v.id)]);
  } catch (err) {
    console.error('Failed to mark visuals export:', err); // CSV всё равно отдаём
  }
  // Без BOM и с CRLF — как у экспорта образов: так Pinterest читает заголовки
  return { csv: lines.join('\r\n'), count: rows.length };
}

module.exports = { previewVisuals, otherLangCount, exportVisualsCsv };

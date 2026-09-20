const { pool, getState, setState } = require('./db');
const { call, MODELS } = require('./llm');

// Каталог картинок игры (эскизы и рендеры) берём через открытый API игры —
// без доступа к её базе и ключей Cloudinary
const FFE_API = process.env.FFE_API_URL || 'https://ffe-production.up.railway.app/api';
const REFRESH_MS = 6 * 3600 * 1000;      // фоновое обновление в прогоне
const STALE_MS = 10 * 60 * 1000;         // при открытии выбора картинки в админке
const NO_REPEAT = 10;   // образ не повторяется в последних N постах
const MIN_FIT = 4;      // картинку ставим, только если она подходит по смыслу

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// В игре correct — чужеродный элемент, которого в образе НЕТ; описание образа — остальные варианты
function descriptor(outfit) {
  const layers = (outfit.game_rows || []).map((r) =>
    `${r.theme}: ${r.options.filter((o) => o !== r.correct).join(', ')}`
  );
  return [outfit.title, ...layers].filter(Boolean).join('; ');
}

// Для Telegram: JPEG с ограничением размера; превью для админки — узкое
const big = (url) => url.replace('/upload/', '/upload/c_limit,w_1280,f_jpg,q_auto/');
const small = (url) => url.replace('/upload/', '/upload/c_limit,w_400,f_jpg,q_auto/');

async function refreshLibrary(maxAgeMs = REFRESH_MS) {
  const last = await getState('library_refreshed_at');
  if (maxAgeMs > 0 && last && Date.now() - new Date(last).getTime() < maxAgeMs) return;

  const { outfits } = await getJson(`${FFE_API}/gallery?lang=ru`);
  const seen = [];

  for (const o of outfits) {
    const text = descriptor(o);
    const rows = [
      { image_id: `sketch:${o.id}`, kind: 'sketch', url: o.image_url, thumb: o.thumb_url, created_at: o.created_at },
      ...(o.renders || []).map((r) => ({ image_id: `render:${r.id}`, kind: 'render', url: r.image_url, thumb: r.thumb_url, created_at: r.created_at })),
    ].filter((r) => r.url);

    for (const r of rows) {
      seen.push(r.image_id);
      await pool.query(
        `INSERT INTO library (image_id, outfit_id, kind, title, descriptor, image_url, thumb_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (image_id) DO UPDATE
         SET title = EXCLUDED.title, descriptor = EXCLUDED.descriptor,
             image_url = EXCLUDED.image_url, thumb_url = EXCLUDED.thumb_url, updated_at = NOW()`,
        [r.image_id, o.id, r.kind, o.title || 'Без названия', text, big(r.url), small(r.thumb || r.url), r.created_at]
      );
    }
  }
  await pool.query('DELETE FROM library WHERE NOT (image_id = ANY($1))', [seen]);
  await setState('library_refreshed_at', new Date().toISOString());
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM library');
  console.log(`[library] ${outfits.length} образов, картинок: ${n}`);
}

const PICK_SYSTEM = `Ты фоторедактор авторского Telegram-канала о смыслах в моде. К посту можно поставить одну картинку из библиотеки образов канала. Выбери образ, который по смыслу перекликается с мыслью поста: тот же код, настроение, силуэт, цвет, тема — так, чтобы читатель увидел в картинке иллюстрацию тезиса. Буквального совпадения предмета не нужно.

fit — насколько картинка подходит, 0–5:
5 — образ прямо иллюстрирует мысль поста
4 — ясная смысловая перекличка
3 и ниже — связь натянутая; в этом случае лучше без картинки (outfit_id = "none").

Большинство постов обходятся без картинки — это нормально.`;

// Модель выбирает образ, а картинку берём лучшую из его: свежий рендер, иначе эскиз
async function pickImage(postText, thesis) {
  const { rows: lib } = await pool.query(
    `SELECT DISTINCT ON (outfit_id) outfit_id, descriptor, image_id, image_url
     FROM library
     WHERE outfit_id NOT IN (
       SELECT outfit_id FROM library WHERE image_id IN (
         SELECT image_ref FROM posts WHERE image_ref IS NOT NULL ORDER BY created_at DESC LIMIT $1
       )
     )
     ORDER BY outfit_id, (kind = 'render') DESC, created_at DESC NULLS LAST`,
    [NO_REPEAT]
  );
  if (!lib.length) return null;

  const catalog = lib.map((l) => `${l.outfit_id} — ${l.descriptor}`).join('\n');
  const pick = await call({
    model: MODELS.cheap,
    system: PICK_SYSTEM,
    user: `Тезис поста: ${thesis}\n\nПост:\n${postText}\n\nБиблиотека образов:\n${catalog}`,
    schema: {
      type: 'object',
      properties: {
        outfit_id: { type: 'string', enum: ['none', ...lib.map((l) => l.outfit_id)] },
        fit: { type: 'integer' },
        reason: { type: 'string' },
      },
      required: ['outfit_id', 'fit', 'reason'],
      additionalProperties: false,
    },
    maxTokens: 1000,
  });
  if (pick.outfit_id === 'none' || pick.fit < MIN_FIT) return null;
  const chosen = lib.find((l) => l.outfit_id === pick.outfit_id);
  console.log(`[library] picked ${pick.outfit_id} (fit ${pick.fit}): ${pick.reason}`);
  return chosen ? { url: chosen.image_url, ref: chosen.image_id } : null;
}

module.exports = { refreshLibrary, pickImage, STALE_MS };

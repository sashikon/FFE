const { pool, getState, setState } = require('./db');
const { call, MODELS } = require('./llm');

// Каталог образов берём через открытый API игры — без доступа к её базе и ключей Cloudinary
const FFE_API = process.env.FFE_API_URL || 'https://ffe-production.up.railway.app/api';
const REFRESH_MS = 24 * 3600 * 1000;
const NO_REPEAT = 10;   // образ не повторяется в последних N постах
const MIN_FIT = 4;      // картинку ставим, только если она подходит по смыслу

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// В игре correct — чужеродный элемент, которого в образе НЕТ; описание образа — остальные варианты
function descriptor(outfit) {
  const layers = (outfit.game_rows || []).map((r) =>
    `${r.theme}: ${r.options.filter((o) => o !== r.correct).join(', ')}`
  );
  return [outfit.title, ...layers].join('; ');
}

// Рендер предпочтительнее исходника: рендеры уже используются для публикации (Pinterest).
// Для Telegram — JPEG с ограничением размера
function imageFor(outfit) {
  const src = outfit.renders?.[0]?.image_url || outfit.image_url;
  return src.replace('/upload/', '/upload/c_limit,w_1280,f_jpg,q_auto/');
}

async function refreshLibrary() {
  const last = await getState('library_refreshed_at');
  if (last && Date.now() - new Date(last).getTime() < REFRESH_MS) return;

  const ids = [];
  for (let page = 1; ; page++) {
    const { outfits, total } = await getJson(`${FFE_API}/outfits?lang=ru&page=${page}`);
    ids.push(...outfits.filter((o) => o.status === 'ready').map((o) => o.id));
    if (!outfits.length || page * 20 >= total) break;
  }

  const { rows } = await pool.query('SELECT outfit_id FROM library');
  const known = new Set(rows.map((r) => r.outfit_id));
  let added = 0;
  for (const id of ids.filter((i) => !known.has(i))) {
    try {
      const o = await getJson(`${FFE_API}/outfit/${id}?lang=ru`);
      if (!o.game_rows) continue;
      await pool.query(
        `INSERT INTO library (outfit_id, title, descriptor, image_url) VALUES ($1, $2, $3, $4)
         ON CONFLICT (outfit_id) DO NOTHING`,
        [id, o.title, descriptor(o), imageFor(o)]
      );
      added++;
    } catch (e) {
      console.warn(`[library] ${id}: ${e.message}`);
    }
  }
  await pool.query('DELETE FROM library WHERE NOT (outfit_id = ANY($1))', [ids]);
  await setState('library_refreshed_at', new Date().toISOString());
  console.log(`[library] ${ids.length} outfits, new: ${added}`);
}

const PICK_SYSTEM = `Ты фоторедактор авторского Telegram-канала о смыслах в моде. К посту можно поставить одну картинку из библиотеки образов канала. Выбери образ, который по смыслу перекликается с мыслью поста: тот же код, настроение, силуэт, цвет, тема — так, чтобы читатель увидел в картинке иллюстрацию тезиса. Буквального совпадения предмета не нужно.

fit — насколько картинка подходит, 0–5:
5 — образ прямо иллюстрирует мысль поста
4 — ясная смысловая перекличка
3 и ниже — связь натянутая; в этом случае лучше без картинки (outfit_id = "none").

Большинство постов обходятся без картинки — это нормально.`;

async function pickImage(postText, thesis) {
  const { rows: lib } = await pool.query(
    `SELECT l.outfit_id, l.descriptor, l.image_url FROM library l
     WHERE l.outfit_id NOT IN (
       SELECT image_ref FROM posts WHERE image_ref IS NOT NULL ORDER BY created_at DESC LIMIT $1
     )`,
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
  return chosen ? { url: chosen.image_url, ref: chosen.outfit_id } : null;
}

module.exports = { refreshLibrary, pickImage };

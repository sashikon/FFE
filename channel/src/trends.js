const Parser = require('rss-parser');
const { pool, getState, setState } = require('./db');
const { call, MODELS } = require('./llm');
const sources = require('./sources');

// Аналитика трендов: из заметок, поисковых трендов Google и скриншотов извлекаем сущности
// (эстетика, вещь, материал, цвет, бренд, термин) и считаем, как часто и где они всплывают.

const KINDS = {
  aesthetic: 'эстетика',
  item: 'вещь',
  material: 'материал',
  color: 'цвет',
  brand: 'бренд',
  term: 'термин',
};

const REGION_TAGS = ['сша', 'британия', 'франция', 'европа', 'россия', 'корея', 'япония', 'китай', 'индия', 'мир'];
const REGION_BY_FEED = Object.fromEntries(sources.map((s) => [s.name, (s.tags || []).find((t) => REGION_TAGS.includes(t)) || 'мир']));

const EXTRACT_BATCH = 40;
const EXTRACT_LIMIT = 400; // заметок за прогон — остальные разберутся в следующий раз

// ─── Извлечение сущностей ───────────────────────────────────────────────────

const EXTRACT_SYSTEM = `Ты аналитик модных трендов. Тебе дают список заметок (заголовок и лид) из мировой модной прессы на разных языках. Для каждой заметки выпиши сущности, по которым можно следить за трендами:
- aesthetic — эстетика или стиль: quiet luxury, balletcore, mob wife, gorpcore, «олд мани»;
- item — вещь или силуэт: barrel jeans, ballet flats, мокасины, бомбер оверсайз;
- material — материал или техника: замша, денима, переработанный полиэстер, плиссе;
- color — цвет или палитра, если о нём речь: butter yellow, бордовый;
- brand — бренд или дом моды: Miu Miu, Bottega Veneta, Uniqlo;
- term — модное слово, явление или практика: dupe, ресейл, deinfluencing, коллаборация люкса и масс-маркета.

Правила:
- term — канон в нижнем регистре. Для явлений, которые обсуждают по всему миру, — англоязычное название («quiet luxury», «balletcore», «dupe»); для местных — на языке оригинала. Одно явление — всегда один и тот же канон.
- display — как написать в интерфейсе: «Quiet luxury», «Miu Miu», «Балеткор».
- Не выписывай общие слова (мода, коллекция, бренд, показ, неделя моды, одежда, продажи), людей, города, компании вне моды.
- Не больше 5 сущностей на заметку. Если в заметке нет модной сущности — пустой список. Это частый ответ.`;

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                term: { type: 'string' },
                display: { type: 'string' },
                kind: { type: 'string', enum: Object.keys(KINDS) },
              },
              required: ['term', 'display', 'kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'entities'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

const canon = (t) => String(t || '').toLowerCase().replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim();

async function upsertTerm({ term, display, kind }) {
  const key = canon(term);
  if (!key || key.length < 2 || key.length > 60) return null;
  const { rows: [row] } = await pool.query(
    `INSERT INTO trend_terms (term, display, kind) VALUES ($1, $2, $3)
     ON CONFLICT (term) DO UPDATE SET term = EXCLUDED.term
     RETURNING id`,
    [key, String(display || term).trim().slice(0, 80), KINDS[kind] ? kind : 'term']
  );
  return row.id;
}

async function addMention(termId, { signal, ref, itemId = null, feed = null, region = null, seenAt = null }) {
  await pool.query(
    `INSERT INTO trend_mentions (term_id, signal, ref, item_id, feed, region, seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
     ON CONFLICT (term_id, ref) DO NOTHING`,
    [termId, signal, ref, itemId, feed, region, seenAt]
  );
}

// Сохранить сущности, найденные для заметки
async function saveEntities(item, entities, signal = 'news') {
  for (const e of entities.slice(0, 5)) {
    const termId = await upsertTerm(e);
    if (!termId) continue;
    await addMention(termId, {
      signal,
      ref: `item:${item.id}`,
      itemId: item.id,
      feed: item.feed,
      region: signal === 'screenshot' ? 'соцсети' : (REGION_BY_FEED[item.feed] || 'мир'),
      seenAt: item.published_at || item.fetched_at,
    });
  }
}

async function extractTrends() {
  const { rows: items } = await pool.query(
    `SELECT id, feed, title, summary, published_at, fetched_at FROM items
     WHERE NOT trends_done ORDER BY fetched_at DESC LIMIT $1`,
    [EXTRACT_LIMIT]
  );
  let found = 0;
  for (let i = 0; i < items.length; i += EXTRACT_BATCH) {
    const batch = items.slice(i, i + EXTRACT_BATCH);
    const list = batch.map((it) => `#${it.id} ${it.title}${it.summary ? ` — ${it.summary.slice(0, 200)}` : ''}`).join('\n');
    try {
      const { results } = await call({ model: MODELS.cheap, system: EXTRACT_SYSTEM, user: list, schema: EXTRACT_SCHEMA, maxTokens: 8000 });
      for (const r of results) {
        const item = batch.find((it) => it.id === r.id);
        if (!item) continue;
        await saveEntities(item, r.entities);
        found += r.entities.length;
      }
      await pool.query('UPDATE items SET trends_done = TRUE WHERE id = ANY($1)', [batch.map((it) => it.id)]);
    } catch (e) {
      console.warn(`[trends] batch failed: ${e.message}`);
    }
  }
  console.log(`[trends] разобрано заметок: ${items.length}, сущностей: ${found}`);
  return { items: items.length, entities: found };
}

// ─── Поисковые тренды Google ────────────────────────────────────────────────

const GEOS = { US: 'сша', GB: 'британия', FR: 'франция', RU: 'россия', KR: 'корея', JP: 'япония' };
const parser = new Parser({ headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, timeout: 20_000 });

const SEARCH_FILTER_SYSTEM = `Тебе дают трендовые поисковые запросы Google за день из разных стран. Почти все они не про моду — спорт, новости, знаменитости. Выбери только те, что прямо про моду, стиль, одежду, обувь, аксессуары, бренды моды или модные события, и для каждого назови модную сущность по тем же правилам: term — канон в нижнем регистре (для мировых явлений по-английски), display, kind.
Знаменитость сама по себе — не мода. Если модных запросов нет — пустой список, это нормальный ответ.`;

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          term: { type: 'string' },
          display: { type: 'string' },
          kind: { type: 'string', enum: Object.keys(KINDS) },
        },
        required: ['query', 'term', 'display', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

async function googleTrending() {
  const day = new Date().toISOString().slice(0, 10);
  if ((await getState('gtrends_day')) === day) return { skipped: true };

  const queries = [];
  for (const [geo, region] of Object.entries(GEOS)) {
    try {
      const feed = await parser.parseURL(`https://trends.google.com/trending/rss?geo=${geo}`);
      for (const e of feed.items || []) queries.push({ geo, region, query: String(e.title || '').trim() });
    } catch (e) {
      console.warn(`[trends] Google Trends ${geo}: ${e.message}`);
    }
  }
  if (!queries.length) return { queries: 0, fashion: 0 };

  const list = queries.map((q) => `${q.geo}: ${q.query}`).join('\n');
  const { results } = await call({ model: MODELS.cheap, system: SEARCH_FILTER_SYSTEM, user: list, schema: SEARCH_SCHEMA, maxTokens: 4000 });
  let saved = 0;
  for (const r of results) {
    const q = queries.find((x) => x.query.toLowerCase() === r.query.toLowerCase().replace(/^[a-z]{2}:\s*/i, ''));
    const termId = await upsertTerm(r);
    if (!termId) continue;
    await addMention(termId, {
      signal: 'search',
      ref: `gtrends:${q?.geo || 'xx'}:${day}:${canon(r.query)}`,
      feed: 'Google Trends',
      region: q?.region || 'мир',
    });
    saved++;
  }
  await setState('gtrends_day', day);
  console.log(`[trends] Google Trends: запросов ${queries.length}, про моду ${saved}`);
  return { queries: queries.length, fashion: saved };
}

// Поисковые подсказки Google: что люди ищут вокруг темы («quiet luxury» → brands, bags, dupes…)
async function fetchSuggestions(term) {
  const hl = /[а-яё]/i.test(term) ? 'ru' : 'en';
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&q=${encodeURIComponent(term)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`suggest ${res.status}`);
  const [, list] = JSON.parse(await res.text());
  return (list || []).filter((s) => canon(s) !== canon(term)).slice(0, 10);
}

async function refreshSuggestions(limit = 15) {
  const { rising } = await listTrends({ limit });
  let done = 0;
  for (const t of rising) {
    const { rows: [row] } = await pool.query('SELECT suggestions_at FROM trend_terms WHERE id = $1', [t.id]);
    if (row?.suggestions_at && Date.now() - new Date(row.suggestions_at).getTime() < 24 * 3600e3) continue;
    try {
      const list = await fetchSuggestions(t.term);
      await pool.query('UPDATE trend_terms SET suggestions = $1, suggestions_at = NOW() WHERE id = $2', [JSON.stringify(list), t.id]);
      done++;
    } catch (e) {
      console.warn(`[trends] подсказки «${t.term}»: ${e.message}`);
    }
  }
  return done;
}

// ─── Расчёт трендов ─────────────────────────────────────────────────────────

// Рост: упоминания за последние 7 дней против предыдущих 7; вес — число разных источников
async function listTrends({ limit = 100, kind = null, region = null } = {}) {
  const { rows } = await pool.query(
    `WITH m AS (
       SELECT term_id, feed, region, signal, seen_at FROM trend_mentions
       WHERE seen_at > NOW() - INTERVAL '56 days'
         AND ($1::text IS NULL OR region = $1)
     )
     SELECT t.id, t.term, t.display, t.kind, t.first_seen, t.suggestions,
            COUNT(*) FILTER (WHERE m.seen_at > NOW() - INTERVAL '7 days')::int AS week,
            COUNT(*) FILTER (WHERE m.seen_at <= NOW() - INTERVAL '7 days' AND m.seen_at > NOW() - INTERVAL '14 days')::int AS prev_week,
            COUNT(*)::int AS total,
            COUNT(DISTINCT m.feed) FILTER (WHERE m.seen_at > NOW() - INTERVAL '14 days')::int AS feeds,
            ARRAY_AGG(DISTINCT m.region) AS regions,
            ARRAY_AGG(DISTINCT m.signal) AS signals,
            ARRAY(
              SELECT COUNT(mm.*)::int FROM generate_series(7, 0, -1) AS w
              LEFT JOIN trend_mentions mm ON mm.term_id = t.id
                AND mm.seen_at > NOW() - make_interval(days => (w + 1) * 7)
                AND mm.seen_at <= NOW() - make_interval(days => w * 7)
              GROUP BY w ORDER BY w DESC
            ) AS weeks
     FROM trend_terms t JOIN m ON m.term_id = t.id
     WHERE ($2::text IS NULL OR t.kind = $2)
     GROUP BY t.id`,
    [region, kind]
  );

  const scored = rows.map((r) => ({
    ...r,
    growth: (r.week + 1) / (r.prev_week + 1),
    // растущие: заметный рост и хотя бы два источника или поисковый сигнал
    score: ((r.week + 1) / (r.prev_week + 1)) * Math.log2(1 + r.feeds) * (r.signals.includes('search') ? 1.5 : 1),
    is_new: Date.now() - new Date(r.first_seen).getTime() < 7 * 24 * 3600e3,
  }));

  const rising = scored
    .filter((r) => r.week >= 2 && (r.feeds >= 2 || r.signals.includes('search') || r.signals.includes('screenshot')) && r.week > r.prev_week)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const top = [...scored].sort((a, b) => b.week - a.week || b.total - a.total).slice(0, limit);
  const fading = scored
    .filter((r) => r.prev_week >= 3 && r.week < r.prev_week / 2)
    .sort((a, b) => b.prev_week - a.prev_week)
    .slice(0, 20);

  return { rising, top, fading, kinds: KINDS };
}

async function termDetail(termId) {
  const { rows: [term] } = await pool.query('SELECT * FROM trend_terms WHERE id = $1', [termId]);
  if (!term) return null;
  const { rows: mentions } = await pool.query(
    `SELECT m.signal, m.feed, m.region, m.seen_at, m.ref, i.title, i.url
     FROM trend_mentions m LEFT JOIN items i ON i.id = m.item_id
     WHERE m.term_id = $1 ORDER BY m.seen_at DESC LIMIT 60`,
    [termId]
  );
  return { term, mentions };
}

// Всё за прогон: сущности из новых заметок, Google Trends раз в день, подсказки для растущих
async function runTrends() {
  const extracted = await extractTrends();
  const search = await googleTrending().catch((e) => ({ error: e.message }));
  const suggestions = await refreshSuggestions().catch(() => 0);
  return { extracted, search, suggestions };
}

module.exports = { KINDS, runTrends, extractTrends, googleTrending, listTrends, termDetail, saveEntities, fetchSuggestions, canon };

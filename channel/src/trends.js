const Parser = require('rss-parser');
const { pool, getState, setState } = require('./db');
const { call, MODELS } = require('./llm');
const pinterest = require('./pinterest');
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
  sound: 'звук',
};

// Категории для вещей: «вещь» — слишком крупный ящик, обувь и сумки живут отдельно
const CATEGORIES = ['обувь', 'одежда', 'верхняя одежда', 'бельё', 'сумки', 'аксессуары', 'украшения', 'головные уборы', 'очки', 'другое'];

const REGION_TAGS = ['сша', 'британия', 'франция', 'италия', 'европа', 'россия', 'корея', 'япония', 'китай', 'индия', 'мир'];
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
- term — канон в нижнем регистре, латиницей: общепринятое английское название («quiet luxury», «balletcore», «leather jacket», «dupe») или имя бренда как он пишется («miu miu», «uniqlo»). Одно явление — всегда один и тот же канон, на каком бы языке ни была заметка: 「レザージャケット」, «кожаная куртка» и «leather jacket» — это один term «leather jacket».
- display — понятное название по-русски: «Кожаная куртка», «Балеткор», «Тихая роскошь». Исключение — бренды и устойчивые английские ярлыки, которые по-русски не говорят: «Miu Miu», «Quiet luxury», «Barrel jeans».
- Иероглифов и хангыля в term и display быть не должно, кроме названий брендов.
- category — только для kind = item: одна из «обувь», «одежда», «верхняя одежда», «бельё», «сумки», «аксессуары», «украшения», «головные уборы», «очки», «другое». Для остальных типов оставь пустым.
- parent — только для конкретной модели: вид, к которому она относится. «adidas samba jane» → parent «mary jane»; «nike air force 1» → parent «sneakers». Для самого вида parent пустой.
- term — это само явление, а не его категория: «bra», а не «item»; «suede», а не «material»; «miu miu», а не «brand». Слова item, brand, term, aesthetic, material, color, sound в поле term недопустимы.

Примеры ответов:
«#12 Calvin Klein launches Perfectly Fit bra» →
{"id": 12, "entities": [{"term": "bra", "display": "Бюстгальтер", "kind": "item", "category": "бельё", "parent": ""}, {"term": "calvin klein", "display": "Calvin Klein", "kind": "brand", "category": "", "parent": ""}]}
«#13 adidas' Samba Mary Jane Is the Leader of the Herd» →
{"id": 13, "entities": [{"term": "mary jane", "display": "Мэри-джейн", "kind": "item", "category": "обувь", "parent": ""}, {"term": "adidas samba jane", "display": "Adidas Samba Jane", "kind": "item", "category": "обувь", "parent": "mary jane"}, {"term": "adidas", "display": "Adidas", "kind": "brand", "category": "", "parent": ""}]}
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
                category: { type: 'string' },
                parent: { type: 'string' },
              },
              required: ['term', 'display', 'kind', 'category', 'parent'],
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

// Слова, которые не могут быть темой: названия категорий и общие слова про моду
const JUNK_TERMS = new Set([
  ...Object.keys(KINDS),
  'мода', 'fashion', 'style', 'стиль', 'одежда', 'clothes', 'clothing', 'apparel',
  'бренд', 'бренды', 'brands', 'тренд', 'тренды', 'trend', 'trends',
  'коллекция', 'collection', 'образ', 'look', 'аксессуары', 'accessories', 'вещь', 'вещи',
]);

const canon = (t) => String(t || '').toLowerCase().replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim();

async function upsertTerm({ term, display, kind, category, parent }) {
  const key = canon(term);
  if (!key || key.length < 2 || key.length > 100 || JUNK_TERMS.has(key)) return null;
  const cat = CATEGORIES.includes(String(category || '').toLowerCase()) ? String(category).toLowerCase() : null;
  const { rows: [row] } = await pool.query(
    `INSERT INTO trend_terms (term, display, kind, category) VALUES ($1, $2, $3, $4)
     ON CONFLICT (term) DO UPDATE SET
       category = COALESCE(trend_terms.category, EXCLUDED.category),
       -- подпись, созданную автоматически (равна каноническому названию), заменяем нормальной
       display = CASE WHEN trend_terms.display = trend_terms.term THEN EXCLUDED.display ELSE trend_terms.display END
     RETURNING id`,
    [key, String(display || term).trim().slice(0, 100), KINDS[kind] ? kind : 'term', cat]
  );

  // модель обуви или сумки привязываем к её виду: «adidas samba jane» → «mary jane»
  const parentKey = canon(parent);
  if (parentKey && parentKey !== key && !JUNK_TERMS.has(parentKey)) {
    const parentId = await upsertTerm({ term: parentKey, display: parent, kind: 'item', category: cat });
    if (parentId) await pool.query('UPDATE trend_terms SET parent_id = $1 WHERE id = $2 AND parent_id IS NULL', [parentId, row.id]);
  }
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
      region: ['screenshot', 'video'].includes(signal) ? 'соцсети' : (REGION_BY_FEED[item.feed] || 'мир'),
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

// Темы-категории («item», «brand»), в которые модель слила несвязанные заметки: убираем их,
// а заметки отправляем на повторный разбор
async function cleanupJunkTerms() {
  const junk = [...JUNK_TERMS];
  const { rows: terms } = await pool.query('SELECT id, term FROM trend_terms WHERE term = ANY($1)', [junk]);
  if (!terms.length) return { removed: 0, requeued: 0 };

  const ids = terms.map((t) => t.id);
  const { rows: affected } = await pool.query('SELECT DISTINCT item_id FROM trend_mentions WHERE term_id = ANY($1) AND item_id IS NOT NULL', [ids]);
  await pool.query('DELETE FROM trend_terms WHERE id = ANY($1)', [ids]); // упоминания уйдут каскадом

  const itemIds = affected.map((a) => a.item_id);
  let requeued = 0;
  if (itemIds.length) {
    // разбираем заново все затронутые заметки: вместо категории у них могла быть настоящая вещь.
    // Повтор безопасен — уже записанные упоминания не задваиваются
    const { rowCount } = await pool.query('UPDATE items SET trends_done = FALSE WHERE id = ANY($1)', [itemIds]);
    requeued = rowCount;
  }
  console.log(`[trends] убрано тем-категорий: ${terms.length} (${terms.map((t) => t.term).join(', ')}), на повторный разбор: ${requeued}`);
  return { removed: terms.length, requeued };
}

// ─── Приведение старых тем к канону ─────────────────────────────────────────
// Раньше промпт разрешал оставлять «местные» явления на языке оригинала, и в темах
// оказались японские и корейские названия обычных вещей. Переименовываем и склеиваем с дублями.

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

const NORMALIZE_SYSTEM = `Тебе дают темы трендов модного канала, записанные иероглифами или хангылем. Приведи каждую к канону:
- term — общепринятое английское название в нижнем регистре («leather jacket», «geta sandals», «quiet luxury») или имя бренда латиницей;
- display — понятное название по-русски («Кожаная куртка», «Сандалии гэта»); для брендов и устойчивых английских ярлыков — как пишут («Miu Miu», «Quiet luxury»).
Если это имя бренда, оставь его латиницей и в term, и в display. Если понять невозможно — верни term и display как есть.`;

const NORMALIZE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, term: { type: 'string' }, display: { type: 'string' } },
        required: ['id', 'term', 'display'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

async function normalizeTerms(limit = 60) {
  const { rows } = await pool.query(
    `SELECT id, term, display, kind FROM trend_terms
     WHERE term ~ '[ぁ-ゟ゠-ヿ㐀-鿿가-힣]' OR display ~ '[ぁ-ゟ゠-ヿ㐀-鿿가-힣]'
     ORDER BY id LIMIT $1`,
    [limit]
  );
  if (!rows.length) return { renamed: 0, merged: 0 };

  const { results } = await call({
    model: MODELS.cheap,
    system: NORMALIZE_SYSTEM,
    user: rows.map((r) => `${r.id}. ${r.display} (${r.term}, ${KINDS[r.kind] || r.kind})`).join('\n'),
    schema: NORMALIZE_SCHEMA,
    maxTokens: 4000,
  });

  let renamed = 0;
  let merged = 0;
  for (const r of results) {
    const row = rows.find((x) => x.id === r.id);
    const key = canon(r.term);
    if (!row || !key || CJK_RE.test(key)) continue;

    const { rows: [existing] } = await pool.query('SELECT id FROM trend_terms WHERE term = $1 AND id <> $2', [key, row.id]);
    if (existing) {
      // такая тема уже есть — переносим упоминания и убираем дубль
      await pool.query('UPDATE trend_mentions SET term_id = $1 WHERE term_id = $2 AND ref NOT IN (SELECT ref FROM trend_mentions WHERE term_id = $1)', [existing.id, row.id]);
      await pool.query('DELETE FROM trend_terms WHERE id = $1', [row.id]);
      merged++;
    } else {
      await pool.query('UPDATE trend_terms SET term = $1, display = $2 WHERE id = $3', [key, r.display.trim().slice(0, 100), row.id]);
      renamed++;
    }
  }
  console.log(`[trends] канон: переименовано ${renamed}, склеено ${merged}`);
  return { renamed, merged };
}

// Разметка уже накопленных вещей: категория (обувь, сумки…) и вид для моделей
const CLASSIFY_SYSTEM = `Тебе дают темы модных трендов типа «вещь». Для каждой определи:
- category — одна из: ${CATEGORIES.join(', ')};
- parent — если это конкретная модель, назови вид, к которому она относится, в нижнем регистре латиницей («adidas samba jane» → «mary jane», «nike air force 1» → «sneakers»). Если это сам вид или что-то общее — пустая строка.
Отвечай по каждой теме.`;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, category: { type: 'string' }, parent: { type: 'string' } },
        required: ['id', 'category', 'parent'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

const CLASSIFY_BATCH = 60;

async function classifyItems(limit = 300) {
  let classified = 0;
  let linked = 0;
  // Разметка догоняет накопленное: за прогон разбираем несколько партий, а не одну
  for (let done = 0; done < limit; done += CLASSIFY_BATCH) {
    const part = await classifyBatch(Math.min(CLASSIFY_BATCH, limit - done));
    classified += part.classified;
    linked += part.linked;
    if (!part.classified) break;
  }
  console.log(`[trends] размечено вещей: ${classified}, привязано моделей: ${linked}`);
  return { classified, linked };
}

async function classifyBatch(limit) {
  const { rows } = await pool.query(
    `SELECT id, term, display FROM trend_terms WHERE kind = 'item' AND category IS NULL ORDER BY id LIMIT $1`,
    [limit]
  );
  if (!rows.length) return { classified: 0, linked: 0 };

  const { results } = await call({
    model: MODELS.cheap,
    system: CLASSIFY_SYSTEM,
    user: rows.map((r) => `${r.id}. ${r.display} (${r.term})`).join('\n'),
    schema: CLASSIFY_SCHEMA,
    maxTokens: 4000,
  });

  let classified = 0;
  let linked = 0;
  for (const r of results) {
    const row = rows.find((x) => x.id === r.id);
    if (!row) continue;
    const cat = CATEGORIES.includes(String(r.category || '').toLowerCase()) ? String(r.category).toLowerCase() : 'другое';
    await pool.query('UPDATE trend_terms SET category = $1 WHERE id = $2', [cat, row.id]);
    classified++;

    const parentKey = canon(r.parent);
    if (parentKey && parentKey !== row.term && !JUNK_TERMS.has(parentKey)) {
      const parentId = await upsertTerm({ term: parentKey, display: parentKey, kind: 'item', category: cat });
      if (parentId && parentId !== row.id) {
        await pool.query('UPDATE trend_terms SET parent_id = $1 WHERE id = $2 AND parent_id IS NULL', [parentId, row.id]);
        linked++;
      }
    }
  }
  return { classified, linked };
}

// Перепроверка типа: «mary jane» и «barrel jeans» могли попасть в «термины» или «эстетики»
// и тогда их не видно во вкладке «Вещи». Каждую тему смотрим один раз.
const REVISE_KINDS = ['term', 'aesthetic', 'material'];
const REVISE_SYSTEM = `Тебе дают темы модных трендов. Про каждую ответь, конкретная ли это вещь — предмет одежды, обуви, сумка, украшение, головной убор, очки, бельё («mary jane», «barrel jeans», «балетки», «тренч») — или нет.
Не вещь: эстетика и стиль («quiet luxury», «балеткор»), материал («замша»), цвет, бренд, явление индустрии («ресейл», «коллаборация»), событие, имя человека.
- is_item — true только для конкретной вещи;
- category — для вещи одна из: ${CATEGORIES.join(', ')}; иначе пустая строка;
- parent — если вещь это конкретная модель, вид, к которому она относится, в нижнем регистре латиницей («adidas samba jane» → «mary jane»); иначе пустая строка.`;

const REVISE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, is_item: { type: 'boolean' }, category: { type: 'string' }, parent: { type: 'string' } },
        required: ['id', 'is_item', 'category', 'parent'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

async function reviseKinds(limit = 120) {
  let moved = 0;
  let checked = 0;
  for (let done = 0; done < limit; done += CLASSIFY_BATCH) {
    const { rows } = await pool.query(
      `SELECT id, term, display, kind FROM trend_terms
       WHERE NOT kind_checked AND kind = ANY($1) ORDER BY id LIMIT $2`,
      [REVISE_KINDS, Math.min(CLASSIFY_BATCH, limit - done)]
    );
    if (!rows.length) break;

    const { results } = await call({
      model: MODELS.cheap,
      system: REVISE_SYSTEM,
      user: rows.map((r) => `${r.id}. ${r.display} (${r.term}) — сейчас «${KINDS[r.kind] || r.kind}»`).join('\n'),
      schema: REVISE_SCHEMA,
      maxTokens: 4000,
    });

    for (const r of results) {
      const row = rows.find((x) => x.id === r.id);
      if (!row || !r.is_item) continue;
      const cat = CATEGORIES.includes(String(r.category || '').toLowerCase()) ? String(r.category).toLowerCase() : 'другое';
      await pool.query(`UPDATE trend_terms SET kind = 'item', category = COALESCE(category, $1) WHERE id = $2`, [cat, row.id]);
      moved++;

      const parentKey = canon(r.parent);
      if (parentKey && parentKey !== row.term && !JUNK_TERMS.has(parentKey)) {
        const parentId = await upsertTerm({ term: parentKey, display: parentKey, kind: 'item', category: cat });
        if (parentId && parentId !== row.id) {
          await pool.query('UPDATE trend_terms SET parent_id = $1 WHERE id = $2 AND parent_id IS NULL', [parentId, row.id]);
        }
      }
    }
    // помечаем всю партию, чтобы не платить за неё второй раз
    await pool.query('UPDATE trend_terms SET kind_checked = TRUE WHERE id = ANY($1)', [rows.map((r) => r.id)]);
    checked += rows.length;
  }
  if (checked) console.log(`[trends] перепроверено тем: ${checked}, переведено в вещи: ${moved}`);
  return { checked, moved };
}

// ─── Pinterest Trends ───────────────────────────────────────────────────────
// Эндпоинт /v5/trends/keywords отдаёт верхние поисковые запросы Pinterest по региону.
// Маркер из панели разработчика живёт 30 дней — истёк даёт 401, об этом пишем в лог явно.

const PINTEREST_REGIONS = { US: 'сша', 'GB+IE': 'британия', FR: 'франция', IT: 'италия', 'DE+AT+CH': 'европа' };
const PINTEREST_TYPES = ['growing', 'monthly']; // что взлетает и что держится месяц
const PINTEREST_LIMIT = 25;
// Без фильтра в топ лезут обои, гача-игры и рецепты: у Pinterest своя аудитория
const PINTEREST_INTERESTS = ['womens_fashion', 'mens_fashion'];

const PINTEREST_FILTER_SYSTEM = `Тебе дают верхние поисковые запросы Pinterest по странам. Pinterest — это не только мода: там рецепты, интерьеры, ремонт, свадьбы, маникюр, обои для телефона. Выбери только то, что прямо про одежду, обувь, аксессуары, украшения, стиль, модные бренды или модные явления, и для каждого назови модную сущность по тем же правилам: term — канон в нижнем регистре (для мировых явлений по-английски), display — по-русски, kind.
Запрос вида «fall outfits 2026» — это про моду, сущность здесь эстетика или вещь, а не сам запрос целиком. Если модных запросов нет — пустой список, это нормальный ответ.`;

async function pinterestKeywords(region, type, token, { interests = PINTEREST_INTERESTS } = {}) {
  // нелатинский символ в переменной иначе падает невнятной ошибкой про ByteString
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error('в маркере посторонние символы — похоже, скопировалось лишнее или не то поле');
  const params = new URLSearchParams({ limit: String(PINTEREST_LIMIT) });
  for (const i of interests) params.append('interests', i);
  const url = `https://api.pinterest.com/v5/trends/keywords/${encodeURIComponent(region)}/top/${type}?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) throw new Error('маркер недействителен или истёк (маркер из панели живёт 30 дней) — выпустите новый и обновите PINTEREST_ACCESS_TOKEN');
  if (res.status === 403) throw new Error('приложению не выдан доступ к трендам (нужен скоуп user_accounts:read и одобренный доступ)');
  if (res.status === 429) throw new Error('превышен дневной лимит запросов');
  // фильтр по интересам мог не подойти этому доступу — лучше общий топ, чем ничего
  if (res.status === 400 && interests.length) {
    console.warn('[trends] Pinterest: фильтр по интересам не принят, беру общий топ');
    return pinterestKeywords(region, type, token, { interests: [] });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.trends || [])
    .map((t) => ({ keyword: String(t.keyword || '').trim(), growth: t.pct_growth_wow ?? null }))
    .filter((t) => t.keyword);
  return { items, filtered: interests.length > 0 };
}

// Истёкший маркер — обычное дело: пробуем обновить и повторить ровно один раз
const EXPIRED = /маркер недействителен или истёк/;

async function withFreshToken(fn, token) {
  try {
    return await fn(token);
  } catch (e) {
    if (!EXPIRED.test(e.message)) throw e;
    const fresh = await pinterest.accessToken({ force: true }).catch(() => null);
    if (!fresh || fresh === token) throw e;
    console.log('[trends] Pinterest: маркер обновлён по refresh');
    return fn(fresh);
  }
}

async function pinterestTrending() {
  const token = await pinterest.accessToken();
  if (!token) return { skipped: 'доступ к Pinterest не настроен' };
  const day = new Date().toISOString().slice(0, 10);
  if ((await getState('pinterest_day')) === day) return { skipped: true };

  const queries = [];
  const failures = [];
  let unfiltered = 0;
  for (const [region, tag] of Object.entries(PINTEREST_REGIONS)) {
    for (const type of PINTEREST_TYPES) {
      try {
        const { items, filtered } = await withFreshToken((t) => pinterestKeywords(region, type, t), token);
        if (!filtered) unfiltered++;
        for (const k of items) queries.push({ ...k, region, tag, type });
      } catch (e) {
        failures.push(`${region}/${type}: ${e.message}`);
      }
    }
  }
  if (failures.length) console.warn(`[trends] Pinterest: ${failures[0]}${failures.length > 1 ? ` (и ещё ${failures.length - 1})` : ''}`);
  if (!queries.length) return { queries: 0, fashion: 0, error: failures[0] || null };

  // одно слово может быть в нескольких странах — спрашиваем модель про каждое один раз,
  // а упоминание ставим по каждой стране, иначе тема теряет географию
  const unique = [...new Map(queries.map((q) => [canon(q.keyword), q])).values()];
  const list = unique.map((q) => q.keyword).join('\n');
  const { results } = await call({ model: MODELS.cheap, system: PINTEREST_FILTER_SYSTEM, user: list, schema: SEARCH_SCHEMA, maxTokens: 4000 });
  const byKeyword = new Map(results.map((r) => [canon(r.query).replace(/^[a-z+]{2,10}:\s*/i, ''), r]));

  let saved = 0;
  const seen = new Set();
  for (const q of queries) {
    const entity = byKeyword.get(canon(q.keyword));
    // «растущее» и «месячное» по одной стране — это один сигнал, а не два
    const ref = `pinterest:${q.region}:${day}:${canon(q.keyword)}`;
    if (!entity || seen.has(ref)) continue;
    seen.add(ref);
    const termId = await upsertTerm(entity);
    if (!termId) continue;
    await addMention(termId, { signal: 'pinterest', ref, feed: 'Pinterest Trends', region: q.tag });
    saved++;
  }
  await setState('pinterest_day', day);
  console.log(`[trends] Pinterest: запросов ${queries.length}, про моду ${saved}${unfiltered ? `, без фильтра по интересам ${unfiltered}` : ''}`);
  return { queries: queries.length, fashion: saved, failures: failures.length, unfiltered };
}

// Живая проверка внешних сигналов: молчаливый пропуск из-за опечатки в переменной
// или истёкшего маркера иначе выглядит так же, как «трендов пока нет»
async function checkSignals() {
  const out = { pinterest: {}, google: {} };
  const token = await pinterest.accessToken().catch(() => null);
  out.pinterest.lastRun = await getState('pinterest_day');
  out.pinterest.token = await pinterest.tokenInfo().catch(() => ({ source: null }));
  if (!token) {
    out.pinterest.problem = out.pinterest.token.missing?.length
      ? `доступ не настроен: нет ${out.pinterest.token.missing.join(', ')}`
      : 'доступ к Pinterest не настроен — /pinterest';
  } else {
    try {
      const { items, filtered } = await withFreshToken((t) => pinterestKeywords('US', 'growing', t), token);
      out.pinterest.ok = true;
      out.pinterest.filtered = filtered;
      out.pinterest.sample = items.slice(0, 3).map((k) => k.keyword);
    } catch (e) {
      out.pinterest.problem = e.message;
    }
  }

  out.google.lastRun = await getState('gtrends_day');
  try {
    const feed = await parser.parseURL('https://trends.google.com/trending/rss?geo=US');
    out.google.ok = true;
    out.google.sample = (feed.items || []).slice(0, 3).map((e) => String(e.title || '').trim());
  } catch (e) {
    out.google.problem = e.message;
  }
  return out;
}

// ─── Расчёт трендов ─────────────────────────────────────────────────────────

// Рост: упоминания за последние 7 дней против предыдущих 7; вес — число разных источников
async function listTrends({ limit = 100, kind = null, region = null, category = null } = {}) {
  const { rows } = await pool.query(
    `WITH m AS (
       SELECT term_id, feed, region, signal, seen_at FROM trend_mentions
       WHERE seen_at > NOW() - INTERVAL '56 days'
         AND ($1::text IS NULL OR region = $1)
     )
     SELECT t.id, t.term, t.display, t.kind, t.category, t.first_seen, t.suggestions,
            (SELECT p.display FROM trend_terms p WHERE p.id = t.parent_id) AS parent,
            (SELECT COUNT(*)::int FROM trend_terms c WHERE c.parent_id = t.id) AS models,
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
     WHERE ($2::text IS NULL OR t.kind = $2) AND ($3::text IS NULL OR t.category = $3)
     GROUP BY t.id`,
    [region, kind, category]
  );

  const scored = rows.map((r) => ({
    ...r,
    growth: (r.week + 1) / (r.prev_week + 1),
    // растущие: заметный рост и хотя бы два источника или поисковый сигнал
    score: ((r.week + 1) / (r.prev_week + 1)) * Math.log2(1 + r.feeds) * (r.signals.some((x) => ['search', 'pinterest'].includes(x)) ? 1.5 : 1),
    is_new: Date.now() - new Date(r.first_seen).getTime() < 7 * 24 * 3600e3,
  }));

  const rising = scored
    .filter((r) => r.week >= 2 && (r.feeds >= 2 || r.signals.some((x) => ['search', 'pinterest', 'screenshot', 'video'].includes(x))) && r.week > r.prev_week)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const top = [...scored].sort((a, b) => b.week - a.week || b.total - a.total).slice(0, limit);
  const fading = scored
    .filter((r) => r.prev_week >= 3 && r.week < r.prev_week / 2)
    .sort((a, b) => b.prev_week - a.prev_week)
    .slice(0, 20);

  return { rising, top, fading, kinds: KINDS, categories: CATEGORIES };
}

// Поиск по названию: тема может не попасть ни в растущие, ни в топ, и её нечем найти
async function searchTerms(q, limit = 40) {
  const needle = `%${canon(q)}%`;
  const { rows } = await pool.query(
    `SELECT t.id, t.term, t.display, t.kind, t.category, t.first_seen, t.suggestions,
            (SELECT p.display FROM trend_terms p WHERE p.id = t.parent_id) AS parent,
            (SELECT COUNT(*)::int FROM trend_terms c WHERE c.parent_id = t.id) AS models,
            COUNT(m.*) FILTER (WHERE m.seen_at > NOW() - INTERVAL '7 days')::int AS week,
            COUNT(m.*) FILTER (WHERE m.seen_at <= NOW() - INTERVAL '7 days' AND m.seen_at > NOW() - INTERVAL '14 days')::int AS prev_week,
            COUNT(m.*)::int AS total,
            COUNT(DISTINCT m.feed)::int AS feeds,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT m.region), NULL) AS regions,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT m.signal), NULL) AS signals,
            ARRAY(
              SELECT COUNT(mm.*)::int FROM generate_series(7, 0, -1) AS w
              LEFT JOIN trend_mentions mm ON mm.term_id = t.id
                AND mm.seen_at > NOW() - make_interval(days => (w + 1) * 7)
                AND mm.seen_at <= NOW() - make_interval(days => w * 7)
              GROUP BY w ORDER BY w DESC
            ) AS weeks
     FROM trend_terms t LEFT JOIN trend_mentions m ON m.term_id = t.id
     WHERE t.term ILIKE $1 OR t.display ILIKE $1
     GROUP BY t.id ORDER BY total DESC LIMIT $2`,
    [needle, limit]
  );
  return rows.map((r) => ({ ...r, growth: (r.week + 1) / (r.prev_week + 1), is_new: false }));
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
  const { rows: models } = await pool.query(
    `SELECT c.id, c.display, COUNT(m.*)::int AS mentions
     FROM trend_terms c LEFT JOIN trend_mentions m ON m.term_id = c.id
     WHERE c.parent_id = $1 GROUP BY c.id ORDER BY mentions DESC`,
    [termId]
  );
  const { rows: [parent] } = await pool.query(
    'SELECT p.id, p.display FROM trend_terms t JOIN trend_terms p ON p.id = t.parent_id WHERE t.id = $1', [termId]
  );
  return { term, mentions, models, parent: parent || null };
}

// Всё за прогон: сущности из новых заметок, Google Trends раз в день, подсказки для растущих
async function runTrends({ onStage = () => {} } = {}) {
  const junk = await cleanupJunkTerms().catch((e) => ({ error: e.message }));
  onStage('разбираю заметки на темы');
  const extracted = await extractTrends();
  const normalized = await normalizeTerms().catch((e) => ({ error: e.message }));
  onStage('перепроверяю типы и размечаю вещи');
  const revised = await reviseKinds().catch((e) => ({ error: e.message }));
  const classified = await classifyItems().catch((e) => ({ error: e.message }));
  onStage('спрашиваю Google и Pinterest');
  const search = await googleTrending().catch((e) => ({ error: e.message }));
  const pinterest = await pinterestTrending().catch((e) => ({ error: e.message }));
  const suggestions = await refreshSuggestions().catch(() => 0);
  return { junk, extracted, normalized, revised, classified, search, pinterest, suggestions };
}

module.exports = { KINDS, CATEGORIES, JUNK_TERMS, runTrends, extractTrends, normalizeTerms, cleanupJunkTerms, classifyItems, reviseKinds, searchTerms, googleTrending, pinterestTrending, checkSignals, listTrends, termDetail, saveEntities, upsertTerm, addMention, fetchSuggestions, canon };

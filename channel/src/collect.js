const Parser = require('rss-parser');
const { pool } = require('./db');
const sources = require('./sources');

const parser = new Parser({
  timeout: 20_000,
  // Fibre2Fashion отвечает 406 на нестандартный User-Agent
  headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*', 'Cache-Control': 'no-cache' },
  customFields: { item: ['source'] },
});

// Заголовки подбирались опытом: полный браузерный User-Agent, наоборот, включает
// защиту от ботов у Launchmetrics, Just Style и Who What Wear — им нужен короткий
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: '*/*',
  'Accept-Language': 'en,it;q=0.9,fr;q=0.8,ja;q=0.7',
  'Cache-Control': 'no-cache',
};
const SITEMAP_LIMIT = 20;

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Status code ${res.status}`);
  return res.text();
}

const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
// Трендовые агентства публикуются раз в несколько недель — им окно шире
const maxAge = (src) => (src.maxAgeDays ? src.maxAgeDays * 24 * 3600 * 1000 : MAX_AGE_MS);

// Вакансии, гороскопы, пустые заголовки — не новости
const NOISE = [
  /\b(jobs?|careers?|vacanc\w*|hiring|internships?)\b/i,
  /\bhoroscope/i,
  /\s-\s[\w .]+,\s[A-Z]{2}\b/, // «Manager - Oak Brook, IL»
];
// В японском, китайском и корейском письме пробелов мало — там считаем знаки, а не слова
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
// Счётчик одного сбора: сколько записей было в ленте и куда каждая делась.
// newest — самая свежая дата в ленте, чтобы отличать «давно не писала» от «всё отсеяли»
const newStats = () => ({ seen: 0, too_old: 0, filtered: 0, dup: 0, added: 0, newest: null });
const noteDate = (stats, d) => {
  if (d && !Number.isNaN(d.getTime()) && (!stats.newest || d > stats.newest)) stats.newest = d;
};

const tooShort = (title) => (CJK.test(title)
  ? title.replace(/\s+/g, '').length < 8
  : title.split(/\s+/).length < 4);

const isNoise = (title) => tooShort(title)
  || NOISE.some((re) => re.test(title))
  || title.split(' - ').length >= 3; // подписи фотогалерей: «Бренд - Недели моды - Подиум - Womenswear - …»

function clean(text = '') {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    [...u.searchParams.keys()]
      .filter((k) => k.startsWith('utm_') || k === 'ref')
      .forEach((k) => u.searchParams.delete(k));
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

// Некоторые ленты отдают 304 с пустым телом, пока адрес не поменяется (Launchmetrics)
const bustCache = (url) => `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;

// Сломанный XML почти всегда — это голый «&» в заголовке, а не настоящая поломка ленты
const fixEntities = (xml) => xml.replace(/&(?![a-zA-Z][a-zA-Z0-9]{0,30};|#\d{1,6};|#x[0-9a-fA-F]{1,6};)/g, '&amp;');

// Что за страница пришла вместо ленты: с адреса дата-центра часто отдают защиту от ботов,
// и без этой подсказки в логе видно только «Unable to parse XML»
function describeBody(text) {
  const head = text.slice(0, 400).toLowerCase();
  if (/<!doctype html|<html/.test(head)) {
    if (/cloudflare|just a moment|attention required|captcha/.test(text.slice(0, 4000).toLowerCase())) {
      return 'вместо ленты пришла страница защиты от ботов (Cloudflare)';
    }
    return 'вместо ленты пришла HTML-страница';
  }
  if (!text.trim()) return 'пустой ответ';
  return `${text.length} байт, начало: ${text.slice(0, 80).replace(/\s+/g, ' ')}`;
}

async function fetchFeed(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Status code ${res.status} — ${describeBody(text)}`);
  return text;
}

async function collectRss(src) {
  const url = src.cacheBust ? bustCache(src.url) : src.url;
  const xml = await fetchFeed(url);
  let feed;
  try {
    feed = await parser.parseString(fixEntities(xml));
  } catch (e) {
    throw new Error(`${e.message.split('\n')[0]} — ${describeBody(xml)}`);
  }
  const isGoogle = src.url.includes('news.google.com');
  const stats = newStats();

  for (const entry of feed.items || []) {
    stats.seen++;
    const published = entry.isoDate ? new Date(entry.isoDate) : null;
    noteDate(stats, published);
    if (!entry.link || !entry.title) { stats.filtered++; continue; }
    if (published && Date.now() - published.getTime() > maxAge(src)) { stats.too_old++; continue; }

    // Google News дописывает « - Издание» к заголовку, а в описании дублирует заголовок
    let title = clean(entry.title);
    let source = src.name;
    if (isGoogle) {
      const publisher = typeof entry.source === 'string' ? entry.source : entry.source?._;
      // Лента одного сайта (site:…) — берём наше название издания, а не домен из <source>
      const singleSite = decodeURIComponent(src.url).includes('site:');
      if (publisher && !singleSite) source = publisher.trim();
      const suffix = ` - ${publisher ? publisher.trim() : source}`;
      if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
      else {
        const m = title.match(/^(.*) - ([^-]+)$/);
        if (m) { title = m[1].trim(); if (!publisher) source = m[2].trim(); }
      }
    }
    // Заголовок, совпадающий с названием издания, — это его главная страница, а не статья
    const sameAsSource = title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === source.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (sameAsSource || isNoise(title)) { stats.filtered++; continue; }
    // У источника может быть свой фильтр по теме (например, только про одежду и стиль)
    if (src.require && !src.require.test(title)) { stats.filtered++; continue; }
    const summary = isGoogle ? null : clean(entry.contentSnippet || entry.content || entry.summary);

    const { rowCount } = await pool.query(
      `INSERT INTO items (source, feed, layer, url, title, summary, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (url) DO NOTHING`,
      [source, src.name, src.layer, normalizeUrl(entry.link), title, summary || null, published]
    );
    if (rowCount) stats.added++; else stats.dup++;
  }
  return stats;
}

// Launchmetrics без no-cache отвечает 304 с пустым телом
const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Издания без RSS: берём свежие адреса из карты сайта, заголовок — со страницы статьи
// или из адреса (titleFrom: 'slug'), если страница собирается скриптом и заголовка в HTML нет
function titleFromSlug(url) {
  const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
  let words = slug.replace(/[-_]+/g, ' ').trim();
  // адреса вида LONDON-FASHION-WEEK-IS-A-CELEBRATION — капс приводим к обычному виду
  if (words === words.toUpperCase() && words.length > 12) words = words.toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function titleFromPage(url, src) {
  const html = await fetchText(url);
  const raw = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || html.match(/<title>([^<]+)/)?.[1];
  return raw ? clean(decode(raw)).replace(src.titleSuffix || /$^/, '').trim() : null;
}

async function collectSitemap(src) {
  const xmls = await Promise.all([].concat(src.url).map(fetchText));
  const stats = newStats();
  const all = xmls
    .flatMap((xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)])
    .map(([, url, lastmod]) => ({ url: decode(url.trim()), published: new Date(lastmod) }))
    .filter((e) => !src.urlFilter || src.urlFilter.test(e.url));
  stats.seen = all.length;
  all.forEach((e) => noteDate(stats, e.published));
  const recent = all.filter((e) => Date.now() - e.published.getTime() <= maxAge(src));
  stats.too_old = all.length - recent.length;
  const fresh = recent.sort((a, b) => b.published - a.published).slice(0, SITEMAP_LIMIT);
  if (!fresh.length) return stats;

  const { rows } = await pool.query('SELECT url FROM items WHERE url = ANY($1)', [fresh.map((e) => e.url)]);
  const known = new Set(rows.map((r) => r.url));
  stats.dup = known.size;

  for (const e of fresh.filter((f) => !known.has(f.url))) {
    let title;
    try {
      title = src.titleFrom === 'slug' ? titleFromSlug(e.url) : await titleFromPage(e.url, src);
    } catch { title = null; }
    if (!title) title = titleFromSlug(e.url);
    if (!title || isNoise(title)) { stats.filtered++; continue; }
    const { rowCount } = await pool.query(
      `INSERT INTO items (source, feed, layer, url, title, published_at)
       VALUES ($1, $1, $2, $3, $4, $5) ON CONFLICT (url) DO NOTHING`,
      [src.name, src.layer, e.url, title, e.published]
    );
    if (rowCount) stats.added++; else stats.dup++;
  }
  return stats;
}

// Публичные Telegram-каналы: веб-версия t.me/s/<канал> отдаёт последние ~20 постов без API и ключей.
// Заголовок — первая строка поста, лид — остальной текст
const decodeEntities = (s) => decode(s).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function telegramPosts(html, channel) {
  return html.split('class="tgme_widget_message_wrap').slice(1).map((block) => {
    const post = block.match(/data-post="([^"]+)"/)?.[1];
    const datetime = block.match(/datetime="([^"]+)"/)?.[1];
    const body = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    if (!post || !body) return null;
    const text = decodeEntities(body.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''))
      .split('\n').map((l) => l.trim()).filter(Boolean);
    return {
      url: `https://t.me/${post}`,
      published: datetime ? new Date(datetime) : null,
      title: (text[0] || '').slice(0, 160),
      summary: text.slice(1).join(' ').slice(0, 800),
      channel,
    };
  }).filter(Boolean);
}

async function collectTelegram(src) {
  const html = await fetchText(`https://t.me/s/${src.channel}`);
  const stats = newStats();
  for (const p of telegramPosts(html, src.channel)) {
    stats.seen++;
    noteDate(stats, p.published);
    if (p.published && Date.now() - p.published.getTime() > maxAge(src)) { stats.too_old++; continue; }
    // Короткие подписи к фото и рекламные посты без текста — не новости
    if (p.title.length + p.summary.length < 80 || isNoise(p.title)) { stats.filtered++; continue; }
    const { rowCount } = await pool.query(
      `INSERT INTO items (source, feed, layer, url, title, summary, published_at)
       VALUES ($1, $1, $2, $3, $4, $5, $6) ON CONFLICT (url) DO NOTHING`,
      [src.name, src.layer, p.url, p.title, p.summary || null, p.published]
    );
    if (rowCount) stats.added++; else stats.dup++;
  }
  return stats;
}

const COLLECTORS = { sitemap: collectSitemap, telegram: collectTelegram };
const collectSource = (src) => (COLLECTORS[src.type] || collectRss)(src);

// Итог сбора пишем в базу: страница источников показывает по нему, сломана лента,
// всё отсеяно фильтрами или издание давно не писало. Ошибка записи не должна ронять сбор
async function saveCheck(name, result) {
  try {
    if (result.status === 'fulfilled') {
      const s = result.value;
      await pool.query(
        `INSERT INTO source_checks (feed, checked_at, ok, error, last_ok_at, seen, too_old, filtered, dup, added, newest_seen)
         VALUES ($1, NOW(), TRUE, NULL, NOW(), $2, $3, $4, $5, $6, $7)
         ON CONFLICT (feed) DO UPDATE SET checked_at = NOW(), ok = TRUE, error = NULL, last_ok_at = NOW(),
           seen = $2, too_old = $3, filtered = $4, dup = $5, added = $6, newest_seen = $7`,
        [name, s.seen, s.too_old, s.filtered, s.dup, s.added, s.newest]
      );
    } else {
      // При ошибке счётчики и last_ok_at остаются от последнего удачного сбора
      await pool.query(
        `INSERT INTO source_checks (feed, checked_at, ok, error) VALUES ($1, NOW(), FALSE, $2)
         ON CONFLICT (feed) DO UPDATE SET checked_at = NOW(), ok = FALSE, error = $2`,
        [name, String(result.reason?.message || result.reason).slice(0, 500)]
      );
    }
  } catch (e) {
    console.warn(`[collect] не записал итог сбора ${name}: ${e.message}`);
  }
}

async function collectAll() {
  const results = await Promise.allSettled(sources.map(collectSource));
  let total = 0;
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') total += r.value.added;
    else console.warn(`[collect] ${sources[i].name}: ${r.reason.message}`);
    await saveCheck(sources[i].name, r);
  }
  console.log(`[collect] new items: ${total}`);
  return total;
}

module.exports = { collectAll };

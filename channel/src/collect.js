const Parser = require('rss-parser');
const { pool } = require('./db');
const sources = require('./sources');

const parser = new Parser({
  timeout: 20_000,
  // Fibre2Fashion отвечает 406 на нестандартный User-Agent
  headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' },
  customFields: { item: ['source'] },
});

const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
// Трендовые агентства публикуются раз в несколько недель — им окно шире
const maxAge = (src) => (src.maxAgeDays ? src.maxAgeDays * 24 * 3600 * 1000 : MAX_AGE_MS);

// Вакансии, гороскопы, пустые заголовки — не новости
const NOISE = [
  /\b(jobs?|careers?|vacanc\w*|hiring|internships?)\b/i,
  /\bhoroscope/i,
  /\s-\s[\w .]+,\s[A-Z]{2}\b/, // «Manager - Oak Brook, IL»
];
const isNoise = (title) => title.split(/\s+/).length < 4
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

async function collectRss(src) {
  const feed = await parser.parseURL(src.url);
  const isGoogle = src.url.includes('news.google.com');
  let added = 0;

  for (const entry of feed.items || []) {
    if (!entry.link || !entry.title) continue;
    const published = entry.isoDate ? new Date(entry.isoDate) : null;
    if (published && Date.now() - published.getTime() > maxAge(src)) continue;

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
    if (isNoise(title)) continue;
    const summary = isGoogle ? null : clean(entry.contentSnippet || entry.content || entry.summary);

    const { rowCount } = await pool.query(
      `INSERT INTO items (source, layer, url, title, summary, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (url) DO NOTHING`,
      [source, src.layer, normalizeUrl(entry.link), title, summary || null, published]
    );
    added += rowCount;
  }
  return added;
}

const HEADERS = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
const SITEMAP_LIMIT = 20;

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Status code ${res.status}`);
  return res.text();
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Издания без RSS: берём свежие адреса из карты сайта, заголовок — со страницы статьи
// или из адреса (titleFrom: 'slug'), если страница собирается скриптом и заголовка в HTML нет
function titleFromSlug(url) {
  const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function titleFromPage(url, src) {
  const html = await fetchText(url);
  const raw = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || html.match(/<title>([^<]+)/)?.[1];
  return raw ? clean(decode(raw)).replace(src.titleSuffix || /$^/, '').trim() : null;
}

async function collectSitemap(src) {
  const xmls = await Promise.all([].concat(src.url).map(fetchText));
  const fresh = xmls
    .flatMap((xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)])
    .map(([, url, lastmod]) => ({ url: decode(url.trim()), published: new Date(lastmod) }))
    .filter((e) => Date.now() - e.published.getTime() <= maxAge(src))
    .filter((e) => !src.urlFilter || src.urlFilter.test(e.url))
    .sort((a, b) => b.published - a.published)
    .slice(0, SITEMAP_LIMIT);
  if (!fresh.length) return 0;

  const { rows } = await pool.query('SELECT url FROM items WHERE url = ANY($1)', [fresh.map((e) => e.url)]);
  const known = new Set(rows.map((r) => r.url));
  let added = 0;

  for (const e of fresh.filter((f) => !known.has(f.url))) {
    let title;
    try {
      title = src.titleFrom === 'slug' ? titleFromSlug(e.url) : await titleFromPage(e.url, src);
    } catch { continue; }
    if (!title || isNoise(title)) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO items (source, layer, url, title, published_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (url) DO NOTHING`,
      [src.name, src.layer, e.url, title, e.published]
    );
    added += rowCount;
  }
  return added;
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
  let added = 0;
  for (const p of telegramPosts(html, src.channel)) {
    if (p.published && Date.now() - p.published.getTime() > maxAge(src)) continue;
    // Короткие подписи к фото и рекламные посты без текста — не новости
    if (p.title.length + p.summary.length < 80 || isNoise(p.title)) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO items (source, layer, url, title, summary, published_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (url) DO NOTHING`,
      [src.name, src.layer, p.url, p.title, p.summary || null, p.published]
    );
    added += rowCount;
  }
  return added;
}

const COLLECTORS = { sitemap: collectSitemap, telegram: collectTelegram };
const collectSource = (src) => (COLLECTORS[src.type] || collectRss)(src);

async function collectAll() {
  const results = await Promise.allSettled(sources.map(collectSource));
  let total = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') total += r.value;
    else console.warn(`[collect] ${sources[i].name}: ${r.reason.message}`);
  });
  console.log(`[collect] new items: ${total}`);
  return total;
}

module.exports = { collectAll };

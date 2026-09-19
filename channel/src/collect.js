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

// Вакансии, гороскопы, пустые заголовки — не новости
const NOISE = [
  /\b(jobs?|careers?|vacanc\w*|hiring|internships?)\b/i,
  /\bhoroscope/i,
  /\s-\s[\w .]+,\s[A-Z]{2}\b/, // «Manager - Oak Brook, IL»
];
const isNoise = (title) => title.split(/\s+/).length < 4 || NOISE.some((re) => re.test(title));

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

async function collectSource(src) {
  const feed = await parser.parseURL(src.url);
  const isGoogle = src.url.includes('news.google.com');
  let added = 0;

  for (const entry of feed.items || []) {
    if (!entry.link || !entry.title) continue;
    const published = entry.isoDate ? new Date(entry.isoDate) : null;
    if (published && Date.now() - published.getTime() > MAX_AGE_MS) continue;

    // Google News дописывает « - Издание» к заголовку, а в описании дублирует заголовок
    let title = clean(entry.title);
    let source = src.name;
    if (isGoogle) {
      const publisher = typeof entry.source === 'string' ? entry.source : entry.source?._;
      if (publisher) source = publisher.trim();
      const suffix = ` - ${source}`;
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

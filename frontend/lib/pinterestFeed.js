// Лента для автопубликации пинов из RSS. Требования Pinterest: RSS 2.0 (не Atom),
// ссылки — на подтверждённый домен, картинка через <enclosure> или <media:content>,
// старое публикуется первым, до 200 пинов в сутки.
const SITE = 'https://ffe-blush.vercel.app';

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

// Cloudinary отдаёт по этому адресу jpeg; размер под вертикальный пин 1000×1500
const pinImage = (url = '') => url.replace('/upload/', '/upload/c_fill,w_1000,h_1500,q_auto,f_jpg/');

const itemLink = (kind, item) => `${SITE}/outfit/${item.outfit_id}?utm_source=pinterest&utm_medium=rss&utm_content=${kind}`;

function feedItem(kind, item) {
  const image = pinImage(item.image_url);
  const description = item.description || `${item.title || 'Образ'} — разбор образа в игре на насмотренность FEMUSE.`;
  return `    <item>
      <title>${esc(item.title || 'Образ')}</title>
      <link>${esc(itemLink(kind, item))}</link>
      <description>${esc(description)}</description>
      <guid isPermaLink="false">${esc(`${kind}:${item.id}`)}</guid>
      <pubDate>${new Date(item.created_at).toUTCString()}</pubDate>
      <enclosure url="${esc(image)}" type="image/jpeg" length="0" />
      <media:content url="${esc(image)}" medium="image" />
    </item>`;
}

const TITLES = {
  renders: 'FEMUSE — образы',
  sketches: 'FEMUSE — эскизы',
};

export function buildFeed(kind, items) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${esc(TITLES[kind] || TITLES.renders)}</title>
    <link>${SITE}</link>
    <description>Образы и разборы из игры на насмотренность FEMUSE.</description>
    <language>ru</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.map((i) => feedItem(kind, i)).join('\n')}
  </channel>
</rss>`;
}

export async function fetchFeedItems(kind) {
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  const r = await fetch(`${base}/api/pinterest-feed?kind=${kind}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { items } = await r.json();
  return items || [];
}

// Слои: industry — бизнес моды, production — производство и материал, culture — культура и потребление.
// Все адреса проверены 2026-09-19. type: 'sitemap' — для изданий без RSS, type: 'telegram' — публичные каналы (см. collect.js). Издания, которые закрывают RSS (BoF, Vogue Business…),
// берём через Google News с фильтром по домену: приходят заголовок и лид — для смысла достаточно.

const gnews = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:3d&hl=en-US&gl=US&ceid=US:en`;
const gnewsRu = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:3d&hl=ru&gl=RU&ceid=RU:ru`;
// Индия: издания выходят реже, окно шире (см. maxAgeDays у источника)
const gnewsIn = (query, days = 14) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:${days}d&hl=en-IN&gl=IN&ceid=IN:en`;
const gnewsKr = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:3d&hl=ko&gl=KR&ceid=KR:ko`;
const gnewsCn = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;

module.exports = [
  // industry
  { name: 'WWD', layer: 'industry', url: 'https://wwd.com/feed/' },
  { name: 'Business of Fashion', layer: 'industry', url: gnews('site:businessoffashion.com/articles') },
  { name: 'Vogue Business', layer: 'industry', url: gnews('site:voguebusiness.com') },
  { name: 'FashionUnited', layer: 'industry', url: gnews('site:fashionunited.com/news') },
  { name: 'Drapers', layer: 'industry', url: 'https://www.drapersonline.com/rss' },
  { name: 'The Industry', layer: 'industry', url: 'https://www.theindustry.fashion/feed/' },
  { name: 'Fashion Dive', layer: 'industry', url: 'https://www.fashiondive.com/feeds/news/' },
  { name: 'Retail Dive', layer: 'industry', url: 'https://www.retaildive.com/feeds/news/' },
  { name: 'Glossy', layer: 'industry', url: 'https://www.glossy.co/feed/' },
  // Jing Daily — люкс и потребитель Китая; RSS нет, берём из карты сайта
  { name: 'Jing Daily', layer: 'industry', type: 'sitemap', url: 'https://jingdaily.com/posts/sitemap.xml', titleSuffix: / \| Jing Daily$/ },

  // трендовые агентства — публикуются редко, окно 30 дней
  { name: 'Heuritech', layer: 'industry', url: 'https://www.heuritech.com/feed/', maxAgeDays: 30 },
  {
    name: 'Peclers Paris',
    layer: 'industry',
    type: 'sitemap',
    url: ['https://www.peclersparis.com/trendbook-sitemap.xml', 'https://www.peclersparis.com/article-sitemap.xml'],
    urlFilter: /lang=en/, // у каждой страницы есть французский дубль
    titleFrom: 'slug', // сайт собирается скриптом, в HTML заголовка нет
    maxAgeDays: 30,
  },

  // ── Азия: другой взгляд на моду, часто более авангардный ──
  { name: 'WWD Japan', layer: 'industry', url: 'https://www.wwdjapan.com/feed' },
  { name: 'Fashionbiz', layer: 'industry', url: gnewsKr('site:fashionbiz.co.kr') },
  { name: 'Fashion Seoul', layer: 'industry', url: 'https://www.fashionseoul.com/rss' },
  { name: 'Fashion Insight', layer: 'industry', url: gnewsKr('site:fi.co.kr') },

  // ── Недели моды и аналитика ──
  { name: 'CFDA', layer: 'industry', type: 'sitemap', url: 'https://cfda.com/sitemap.xml', urlFilter: /\/news\//, maxAgeDays: 30 },
  {
    name: 'British Fashion Council',
    layer: 'industry',
    type: 'sitemap',
    url: 'https://britishfashioncouncil.co.uk/sitemap.xml',
    urlFilter: /\/BFCNews\//,
    titleFrom: 'slug', // страницы собираются скриптом, заголовка в HTML нет
    maxAgeDays: 30,
  },
  { name: 'Launchmetrics', layer: 'industry', url: 'https://launchmetrics.com/feed', maxAgeDays: 30, cacheBust: true },
  { name: 'EDITED', layer: 'industry', type: 'sitemap', url: 'https://edited.com/post-sitemap.xml', urlFilter: /\/blog\/.+/, maxAgeDays: 45 },

  // production — самый ценный слой: здесь меньше всего чужих интерпретаций
  { name: 'Just Style', layer: 'production', url: 'https://www.just-style.com/feed/' },
  { name: 'Fibre2Fashion', layer: 'production', url: 'https://www.fibre2fashion.com/news/rss/news.xml' },
  { name: 'Textile World', layer: 'production', url: 'https://www.textileworld.com/feed/' },
  { name: 'Innovation in Textiles', layer: 'production', url: 'https://www.innovationintextiles.com/rss/' },
  // 한국섬유신문 — корейская текстильная газета
  { name: 'Korea Textile News', layer: 'production', url: 'https://www.ktnews.com/rss/allArticle.xml' },
  { name: 'Ecotextile News', layer: 'production', url: gnews('site:ecotextile.com') },
  { name: 'GN: garment workers', layer: 'production', url: gnews('"garment workers" OR "garment factory"') },
  { name: 'GN: textile supply chain', layer: 'production', url: gnews('textile "supply chain" fashion') },
  { name: 'GN: secondhand & resale', layer: 'production', url: gnews('fashion resale OR secondhand OR "textile waste"') },

  // culture
  { name: 'Vogue', layer: 'culture', url: 'https://www.vogue.com/feed/rss' },
  // Официальные организаторы недель моды публикуются по сезонам — окно шире
  { name: 'FHCM Paris', layer: 'culture', url: 'https://fhcm.paris/rss.xml', maxAgeDays: 90 },
  { name: 'FDCI Индия', layer: 'culture', url: 'https://fdci.org/feed', maxAgeDays: 90 },
  { name: 'Dazed', layer: 'culture', url: 'https://www.dazeddigital.com/rss' },
  { name: 'i-D', layer: 'culture', url: 'https://i-d.co/feed/' },
  { name: 'Highsnobiety', layer: 'culture', url: 'https://www.highsnobiety.com/feed/' },
  { name: 'Hypebeast', layer: 'culture', url: 'https://hypebeast.com/feed' },
  { name: 'Who What Wear', layer: 'culture', url: 'https://www.whowhatwear.com/rss' },
  { name: 'Fashionsnap', layer: 'culture', url: 'https://www.fashionsnap.com/rss.xml' },
  { name: 'Vogue Korea', layer: 'culture', url: gnewsKr('site:vogue.co.kr') },
  { name: 'Vogue China', layer: 'culture', url: gnewsCn('site:vogue.com.cn'), maxAgeDays: 7 },
  // Корейские знаменитости первыми выносят на публику локальные бренды; берём только про одежду и стиль
  {
    name: 'Dispatch',
    layer: 'culture',
    url: gnewsKr('site:dispatch.co.kr (패션 OR 스타일 OR 공항패션)'),
    // Google News понимает запрос свободно, поэтому отбираем ещё раз по заголовку:
    // мода, стиль, лук, надел, аэропорт, бренд, костюм, наряд
    require: /패션|스타일|룩|착장|착용|공항|출국|입국|브랜드|수트|의상|화보|드레스|재킷|코트/,
    maxAgeDays: 7,
  },

  // Индийское издание о моде, ремесле и текстиле; своей ленты нет, карта сайта не обновляется
  { name: 'The Voice of Fashion', layer: 'culture', url: gnewsIn('site:thevoiceoffashion.com'), maxAgeDays: 14 },
  { name: 'The Guardian Fashion', layer: 'culture', url: 'https://www.theguardian.com/fashion/rss' },
  { name: 'NYT Fashion', layer: 'culture', url: 'https://www.nytimes.com/svc/collections/v1/publish/https://www.nytimes.com/section/fashion/rss.xml' },
  { name: 'The Cut', layer: 'culture', url: gnews('site:thecut.com fashion') },
  // ── Русскоязычные ──
  // Многие закрывают сайт от зарубежных запросов, поэтому берём их Telegram-каналы (type: 'telegram')
  { name: 'BeInOpen', layer: 'industry', type: 'telegram', channel: 'beinopen' },
  { name: 'FashionNetwork RU', layer: 'industry', url: gnewsRu('site:ru.fashionnetwork.com') },
  { name: 'The Blueprint', layer: 'culture', type: 'telegram', channel: 'theblueprintru' },
  { name: 'РБК Стиль', layer: 'culture', type: 'telegram', channel: 'rbcstyle' },
  { name: 'The Symbol', layer: 'culture', type: 'telegram', channel: 'thesymbolru' },
  // RSS Buro (buro247.ru/rss) отстаёт на неделю — свежее через Google News
  { name: 'Buro 24/7', layer: 'culture', url: gnewsRu('site:buro247.ru') },

  { name: 'GN: dress code', layer: 'culture', url: gnews('"dress code" OR uniform clothing') },
  // для формата «Психология стиля»
  { name: 'GN: clothing psychology', layer: 'culture', url: gnews('"enclothed cognition" OR "fashion psychology" OR (clothing study perception)') },
];

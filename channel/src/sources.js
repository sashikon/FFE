// Слои: industry — бизнес моды, production — производство и материал, culture — культура и потребление.
// Все адреса проверены 2026-09-19. type: 'sitemap' — для изданий без RSS (см. collect.js). Издания, которые закрывают RSS (BoF, Vogue Business…),
// берём через Google News с фильтром по домену: приходят заголовок и лид — для смысла достаточно.

const gnews = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:3d&hl=en-US&gl=US&ceid=US:en`;

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

  // production — самый ценный слой: здесь меньше всего чужих интерпретаций
  { name: 'Just Style', layer: 'production', url: 'https://www.just-style.com/feed/' },
  { name: 'Fibre2Fashion', layer: 'production', url: 'https://www.fibre2fashion.com/news/rss/news.xml' },
  { name: 'Textile World', layer: 'production', url: 'https://www.textileworld.com/feed/' },
  { name: 'Innovation in Textiles', layer: 'production', url: 'https://www.innovationintextiles.com/rss/' },
  { name: 'Ecotextile News', layer: 'production', url: gnews('site:ecotextile.com') },
  { name: 'GN: garment workers', layer: 'production', url: gnews('"garment workers" OR "garment factory"') },
  { name: 'GN: textile supply chain', layer: 'production', url: gnews('textile "supply chain" fashion') },
  { name: 'GN: secondhand & resale', layer: 'production', url: gnews('fashion resale OR secondhand OR "textile waste"') },

  // culture
  { name: 'Vogue', layer: 'culture', url: 'https://www.vogue.com/feed/rss' },
  { name: 'Dazed', layer: 'culture', url: 'https://www.dazeddigital.com/rss' },
  { name: 'i-D', layer: 'culture', url: 'https://i-d.co/feed/' },
  { name: 'Highsnobiety', layer: 'culture', url: 'https://www.highsnobiety.com/feed/' },
  { name: 'Hypebeast', layer: 'culture', url: 'https://hypebeast.com/feed' },
  { name: 'Who What Wear', layer: 'culture', url: 'https://www.whowhatwear.com/rss' },
  { name: 'The Guardian Fashion', layer: 'culture', url: 'https://www.theguardian.com/fashion/rss' },
  { name: 'NYT Fashion', layer: 'culture', url: 'https://www.nytimes.com/svc/collections/v1/publish/https://www.nytimes.com/section/fashion/rss.xml' },
  { name: 'The Cut', layer: 'culture', url: gnews('site:thecut.com fashion') },
  { name: 'GN: dress code', layer: 'culture', url: gnews('"dress code" OR uniform clothing') },
  // для формата «Психология стиля»
  { name: 'GN: clothing psychology', layer: 'culture', url: gnews('"enclothed cognition" OR "fashion psychology" OR (clothing study perception)') },
];

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
const gnewsIt = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:3d&hl=it&gl=IT&ceid=IT:it`;
const gnewsKr = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:3d&hl=ko&gl=KR&ceid=KR:ko`;
const gnewsCn = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;

module.exports = [
  // industry
  { name: 'WWD', description: 'Главное американское издание о бизнесе моды: сделки, назначения, розница.', tags: ['сша', 'бизнес', 'ежедневно'], layer: 'industry', url: 'https://wwd.com/feed/' },
  { name: 'Business of Fashion', description: 'Аналитика индустрии: стратегии брендов, деньги, разборы рынка.', tags: ['мир', 'бизнес', 'аналитика'], layer: 'industry', url: gnews('site:businessoffashion.com/articles') },
  { name: 'Vogue Business', description: 'Мода как индустрия: потребитель, технологии, маркетинг.', tags: ['мир', 'бизнес', 'аналитика'], layer: 'industry', url: gnews('site:voguebusiness.com') },
  { name: 'FashionUnited', description: 'Новости индустрии и рынка труда моды, много Европы.', tags: ['европа', 'бизнес'], layer: 'industry', url: gnews('site:fashionunited.com/news') },
  { name: 'Drapers', description: 'Британская розница и марки: как продаётся мода в Великобритании.', tags: ['британия', 'ритейл'], layer: 'industry', url: 'https://www.drapersonline.com/rss' },
  { name: 'The Industry', description: 'Британские новости моды и ритейла, быстрые заметки.', tags: ['британия', 'ритейл'], layer: 'industry', url: 'https://www.theindustry.fashion/feed/' },
  { name: 'Fashion Dive', description: 'Короткие деловые новости моды для американского рынка.', tags: ['сша', 'бизнес'], layer: 'industry', url: 'https://www.fashiondive.com/feeds/news/' },
  { name: 'Retail Dive', description: 'Розница целиком: магазины, логистика, поведение покупателя.', tags: ['сша', 'ритейл'], layer: 'industry', url: 'https://www.retaildive.com/feeds/news/' },
  { name: 'Glossy', description: 'Мода, красота и медиа: маркетинг, соцсети, новые каналы продаж.', tags: ['сша', 'маркетинг'], layer: 'industry', url: 'https://www.glossy.co/feed/' },
  // Jing Daily — люкс и потребитель Китая; RSS нет, берём из карты сайта
  { name: 'Jing Daily', description: 'Люкс и китайский потребитель: как бренды разговаривают с Азией.', tags: ['китай', 'люкс', 'аналитика'], layer: 'industry', type: 'sitemap', url: 'https://jingdaily.com/posts/sitemap.xml', titleSuffix: / \| Jing Daily$/ },

  // трендовые агентства — публикуются редко, окно 30 дней
  { name: 'Heuritech', description: 'Прогноз трендов по данным соцсетей: что растёт в спросе.', tags: ['мир', 'прогноз', 'аналитика'], layer: 'industry', url: 'https://www.heuritech.com/feed/', maxAgeDays: 30 },
  {
    name: 'Peclers Paris', description: 'Парижское бюро прогнозов: тренд-буки на сезоны вперёд.', tags: ['мир', 'прогноз'],
    layer: 'industry',
    type: 'sitemap',
    url: ['https://www.peclersparis.com/trendbook-sitemap.xml', 'https://www.peclersparis.com/article-sitemap.xml'],
    urlFilter: /lang=en/, // у каждой страницы есть французский дубль
    titleFrom: 'slug', // сайт собирается скриптом, в HTML заголовка нет
    maxAgeDays: 30,
  },

  // ── Италия: без неё картина мировой моды неполная ──
  { name: 'Pambianco', description: 'Итальянская деловая пресса о моде: марки, сделки, рынок, назначения.', tags: ['италия', 'бизнес'], layer: 'industry', url: 'https://www.pambianconews.com/feed/' },
  { name: 'Il Sole 24 Ore Moda', description: 'Деловое издание Италии, раздел моды: индустрия и экономика.', tags: ['италия', 'бизнес'], layer: 'industry', maxAgeDays: 7, url: 'https://www.ilsole24ore.com/rss/moda.xml' },

  // ── Азия: другой взгляд на моду, часто более авангардный ──
  { name: 'WWD Japan', description: 'Японская индустрия моды и красоты: бренды, коллаборации, рынок.', tags: ['япония', 'бизнес'], layer: 'industry', url: 'https://www.wwdjapan.com/feed' },
  { name: 'Fashionbiz', description: 'Корейская деловая пресса о моде: марки, продажи, запуски.', tags: ['корея', 'бизнес'], layer: 'industry', url: gnewsKr('site:fashionbiz.co.kr') },
  { name: 'Fashion Seoul', description: 'Корейская мода: бренды, амбассадоры, тренды сезона.', tags: ['корея', 'бизнес', 'тренды'], layer: 'industry', url: 'https://www.fashionseoul.com/rss' },
  { name: 'Fashion Insight', description: 'Корейское отраслевое издание о марках и рознице.', tags: ['корея', 'бизнес'], layer: 'industry', url: gnewsKr('site:fi.co.kr') },

  // ── Недели моды и аналитика ──
  { name: 'CFDA', description: 'Совет дизайнеров Америки: расписание NYFW, премии, программы поддержки.', tags: ['сша', 'неделя моды', 'институция'], layer: 'industry', type: 'sitemap', url: 'https://cfda.com/sitemap.xml', urlFilter: /\/news\//, maxAgeDays: 30 },
  {
    name: 'British Fashion Council', description: 'Британский совет моды: итоги LFW, исследования, премии.', tags: ['британия', 'неделя моды', 'институция'],
    layer: 'industry',
    type: 'sitemap',
    url: 'https://britishfashioncouncil.co.uk/sitemap.xml',
    urlFilter: /\/BFCNews\//,
    titleFrom: 'slug', // страницы собираются скриптом, заголовка в HTML нет
    maxAgeDays: 30,
  },
  { name: 'Launchmetrics', description: 'Аналитика медийной стоимости брендов и показов (MIV).', tags: ['мир', 'аналитика', 'маркетинг'], layer: 'industry', url: 'https://launchmetrics.com/feed', maxAgeDays: 30, cacheBust: true },
  { name: 'EDITED', description: 'Розничная аналитика по данным: ассортимент, цены, скидки.', tags: ['мир', 'аналитика', 'ритейл'], layer: 'industry', type: 'sitemap', url: 'https://edited.com/post-sitemap.xml', urlFilter: /\/blog\/.+/, maxAgeDays: 45 },

  // production — самый ценный слой: здесь меньше всего чужих интерпретаций
  { name: 'Just Style', description: 'Производство одежды: фабрики, заказы, торговые барьеры.', tags: ['мир', 'производство', 'цепочка поставок'], layer: 'production', url: 'https://www.just-style.com/feed/' },
  { name: 'Fibre2Fashion', description: 'Текстиль и волокна: сырьё, технологии, торговля.', tags: ['мир', 'производство', 'материалы'], layer: 'production', url: 'https://www.fibre2fashion.com/news/rss/news.xml' },
  { name: 'Textile World', description: 'Текстильная промышленность США: оборудование, материалы.', tags: ['сша', 'производство', 'материалы'], layer: 'production', url: 'https://www.textileworld.com/feed/' },
  { name: 'Innovation in Textiles', description: 'Новые материалы и технологии текстиля.', tags: ['мир', 'производство', 'материалы'], layer: 'production', url: 'https://www.innovationintextiles.com/rss/' },
  // 한국섬유신문 — корейская текстильная газета
  { name: 'Korea Textile News', description: 'Корейская текстильная газета: производство и марки.', tags: ['корея', 'производство'], layer: 'production', url: 'https://www.ktnews.com/rss/allArticle.xml' },
  { name: 'Ecotextile News', description: 'Экология текстиля: химия, сертификация, отходы.', tags: ['мир', 'производство', 'устойчивость'], layer: 'production', url: gnews('site:ecotextile.com') },
  { name: 'GN: garment workers', description: 'Поиск новостей о рабочих швейных фабрик: условия труда, забастовки.', tags: ['мир', 'производство', 'труд', 'поиск'], layer: 'production', url: gnews('"garment workers" OR "garment factory"') },
  { name: 'GN: textile supply chain', description: 'Поиск новостей о цепочках поставок текстиля.', tags: ['мир', 'производство', 'цепочка поставок', 'поиск'], layer: 'production', url: gnews('textile "supply chain" fashion') },
  { name: 'GN: secondhand & resale', description: 'Поиск новостей о ресейле, секонд-хенде и текстильных отходах.', tags: ['мир', 'ресейл', 'устойчивость', 'поиск'], layer: 'production', url: gnews('fashion resale OR secondhand OR "textile waste"') },

  // culture
  { name: 'Vogue', description: 'Американский Vogue: показы, кампейны, культура моды.', tags: ['сша', 'люкс', 'культура'], layer: 'culture', url: 'https://www.vogue.com/feed/rss' },
  // Официальные организаторы недель моды публикуются по сезонам — окно шире
  { name: 'FHCM Paris', description: 'Организатор Парижской недели: рецензии на показы и кутюр.', tags: ['франция', 'неделя моды', 'институция'], layer: 'culture', url: 'https://fhcm.paris/rss.xml', maxAgeDays: 90 },
  { name: 'FDCI Индия', description: 'Совет модного дизайна Индии: кутюр, ремесло, местные дизайнеры.', tags: ['индия', 'неделя моды', 'ремесло'], layer: 'culture', url: 'https://fdci.org/feed', maxAgeDays: 90 },
  { name: 'Dazed', description: 'Молодая культура и мода на грани: субкультуры, эксперимент.', tags: ['британия', 'культура', 'авангард'], layer: 'culture', url: 'https://www.dazeddigital.com/rss' },
  { name: 'i-D', description: 'Культовый журнал о моде и идентичности поколений.', tags: ['британия', 'культура', 'авангард'], layer: 'culture', url: 'https://i-d.co/feed/' },
  { name: 'Highsnobiety', description: 'Стрит, кроссовки, коллаборации люкса и улицы.', tags: ['мир', 'стрит', 'люкс'], layer: 'culture', url: 'https://www.highsnobiety.com/feed/' },
  { name: 'Hypebeast', description: 'Стритвир и дропы: что покупает молодая аудитория.', tags: ['мир', 'стрит'], layer: 'culture', url: 'https://hypebeast.com/feed' },
  { name: 'Who What Wear', description: 'Тренды для читателя: что носить и как это читается.', tags: ['сша', 'тренды', 'потребитель'], layer: 'culture', url: 'https://www.whowhatwear.com/rss' },
  { name: 'Fashionsnap', description: 'Японская мода и дизайн: бренды, магазины, уличный стиль.', tags: ['япония', 'культура', 'стрит'], layer: 'culture', url: 'https://www.fashionsnap.com/rss.xml' },
  { name: 'Vogue Italia', description: 'Итальянский Vogue: показы Милана, кампейны, светская мода.', tags: ['италия', 'люкс', 'культура'], layer: 'culture', url: gnewsIt('site:vogue.it') },
  { name: 'Vogue Korea', description: 'Корейский Vogue: звёзды, кампейны, локальные бренды.', tags: ['корея', 'люкс', 'культура'], layer: 'culture', url: gnewsKr('site:vogue.co.kr') },
  { name: 'Vogue China', description: 'Китайский Vogue: показы, кампейны, местная сцена.', tags: ['китай', 'люкс', 'культура'], layer: 'culture', url: gnewsCn('site:vogue.com.cn'), maxAgeDays: 7 },
  // Корейские знаменитости первыми выносят на публику локальные бренды; берём только про одежду и стиль
  {
    name: 'Dispatch', description: 'Корейские знаменитости и их образы: что носят айдолы, какие бренды выносят на публику.', tags: ['корея', 'знаменитости', 'стрит'],
    layer: 'culture',
    url: gnewsKr('site:dispatch.co.kr (패션 OR 스타일 OR 공항패션)'),
    // Google News понимает запрос свободно, поэтому отбираем ещё раз по заголовку:
    // мода, стиль, лук, надел, аэропорт, бренд, костюм, наряд
    require: /패션|스타일|룩|착장|착용|공항|출국|입국|브랜드|수트|의상|화보|드레스|재킷|코트/,
    maxAgeDays: 7,
  },

  // Индийское издание о моде, ремесле и текстиле; своей ленты нет, карта сайта не обновляется
  { name: 'The Voice of Fashion', description: 'Индийское издание о моде, ремесле и текстиле.', tags: ['индия', 'ремесло', 'культура'], layer: 'culture', url: gnewsIn('site:thevoiceoffashion.com'), maxAgeDays: 14 },
  { name: 'The Guardian Fashion', description: 'Мода в общественном контексте: политика, гендер, этика.', tags: ['британия', 'культура', 'общество'], layer: 'culture', url: 'https://www.theguardian.com/fashion/rss' },
  { name: 'NYT Fashion', description: 'Мода как культурное явление, репортажи и портреты.', tags: ['сша', 'культура', 'общество'], layer: 'culture', url: 'https://www.nytimes.com/svc/collections/v1/publish/https://www.nytimes.com/section/fashion/rss.xml' },
  { name: 'The Cut', description: 'Мода, тело и повседневность глазами женской редакции.', tags: ['сша', 'культура', 'общество'], layer: 'culture', url: gnews('site:thecut.com fashion') },
  // ── Русскоязычные ──
  // Многие закрывают сайт от зарубежных запросов, поэтому берём их Telegram-каналы (type: 'telegram')
  { name: 'BeInOpen', description: 'Российская индустрия моды: бизнес-кейсы, образование, форумы.', tags: ['россия', 'бизнес', 'образование'], layer: 'industry', type: 'telegram', channel: 'beinopen' },
  { name: 'FashionNetwork RU', description: 'Новости мировой индустрии на русском.', tags: ['россия', 'бизнес'], layer: 'industry', url: gnewsRu('site:ru.fashionnetwork.com') },
  { name: 'The Blueprint', description: 'Российское издание о моде и культуре, сильные тексты.', tags: ['россия', 'культура'], layer: 'culture', type: 'telegram', channel: 'theblueprintru' },
  { name: 'РБК Стиль', description: 'Мода и стиль жизни для делового читателя.', tags: ['россия', 'культура', 'потребитель'], layer: 'culture', type: 'telegram', channel: 'rbcstyle' },
  { name: 'The Symbol', description: 'Российское издание о стиле и красоте.', tags: ['россия', 'культура'], layer: 'culture', type: 'telegram', channel: 'thesymbolru' },
  // RSS Buro (buro247.ru/rss) отстаёт на неделю — свежее через Google News
  { name: 'Buro 24/7', description: 'Показы, кампейны и светская мода на русском.', tags: ['россия', 'люкс', 'культура'], layer: 'culture', url: gnewsRu('site:buro247.ru') },

  { name: 'GN: dress code', description: 'Поиск новостей о дресс-кодах и форме: где правила одежды меняются.', tags: ['мир', 'общество', 'поиск'], layer: 'culture', url: gnews('"dress code" OR uniform clothing') },
  // для формата «Психология стиля»
  { name: 'GN: clothing psychology', description: 'Поиск исследований о психологии одежды и восприятия.', tags: ['мир', 'психология', 'наука', 'поиск'], layer: 'culture', url: gnews('"enclothed cognition" OR "fashion psychology" OR (clothing study perception)') },
];

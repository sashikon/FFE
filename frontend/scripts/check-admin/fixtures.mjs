// Подставные ответы для проверки админки. Форма повторяет то, что отдают
// channel/src/api.js (запросы к базе) и backend: по одному-два элемента на список,
// чтобы страницы отрисовали карточки, а не только «пусто».
// Поменяли форму ответа в API — поправьте и здесь, иначе проверка будет смотреть на старую.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const channelSrc = fileURLToPath(new URL('../../../channel/src/', import.meta.url));
// эти модули не трогают базу и сеть — берём настоящие данные
const { STEPS, VARIABLES } = require(`${channelSrc}assembly.js`);
const { FORMATS } = require(`${channelSrc}formats.js`);

const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 864e5).toISOString();
const day = (n) => daysAgo(-n).slice(0, 10);

const KINDS = { aesthetic: 'эстетика', item: 'вещь', material: 'материал', color: 'цвет', brand: 'бренд', term: 'термин', sound: 'звук' };
const CATEGORIES = ['обувь', 'одежда', 'верхняя одежда', 'бельё', 'сумки', 'аксессуары', 'украшения', 'головные уборы', 'очки', 'другое'];

const post = (id, status, extra = {}) => ({
  id,
  status,
  format: FORMATS[0].key,
  format_title: FORMATS[0].title,
  text: `Пост №${id}. Балетки вернулись не как обувь, а как жест: удобство стало статусом.`,
  image_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  created_at: daysAgo(3),
  approved_at: status === 'draft' ? null : daysAgo(2),
  published_at: status === 'published' ? daysAgo(1) : null,
  channel_message_id: status === 'published' ? 42 : null,
  channel_url: status === 'published' ? 'https://t.me/example/42' : null,
  thesis: 'Удобство стало статусом',
  lens: 'статус',
  skeleton: { change: 'удобство вместо статуса', answer: 'Удобство стало статусом', movement: 'дедукция', points: ['первый довод', 'второй довод'] },
  research_sources: [{ title: 'Vogue Business', url: 'https://www.voguebusiness.com/' }],
  origin: 'feed',
  slop: status === 'draft' ? ['действительно'] : [],
  ...extra,
});

const trend = (id, extra = {}) => ({
  id,
  term: `term ${id}`,
  display: id === 1 ? 'тихая роскошь' : 'балетки',
  kind: id === 1 ? 'aesthetic' : 'item',
  category: id === 1 ? null : 'обувь',
  first_seen: daysAgo(id === 1 ? 40 : 3),
  suggestions: ['ballet flats trend', 'балетки с чем носить'],
  parent: null,
  models: 0,
  week: 5,
  prev_week: 2,
  total: 12,
  feeds: 3,
  regions: ['мир', 'сша'],
  signals: ['press', 'search'],
  weeks: [0, 1, 1, 2, 1, 2, 2, 5],
  growth: 2,
  score: 3,
  is_new: id !== 1,
  ...extra,
});

// API канала: ключ — путь без /api, как его видит сервис канала
export const channel = {
  '/api/posts': () => ({
    channel: { title: 'Смыслы в моде', url: 'https://t.me/example' },
    posts: [post(1, 'draft'), post(2, 'approved'), post(3, 'published'), post(4, 'deferred', { image_url: null, format: null, format_title: null, skeleton: null })],
    counts: { draft: 1, approved: 1, published: 1, deferred: 1 },
  }),
  '/api/channel': () => ({ channel: { title: 'Смыслы в моде', username: 'example', url: 'https://t.me/example' } }),
  '/api/library': () => ({
    images: [
      { image_id: 'img1', outfit_id: 7, kind: 'render', title: 'Образ 7', descriptor: 'плащ, балетки', thumb_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg', created_at: daysAgo(5) },
      { image_id: 'img2', outfit_id: 7, kind: 'sketch', title: 'Образ 7', descriptor: null, thumb_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg', created_at: null },
    ],
    counts: { sketches: 1, renders: 1, outfits: 1 },
  }),
  '/api/sources': () => ({
    sources: [
      { name: 'Business of Fashion', description: 'Индустрия и деньги', tags: ['индустрия', 'британия'], layer: 'industry', kind: 'RSS', url: 'https://www.businessoffashion.com/feed', week: 12, total: 340, last_published: daysAgo(1), posts: 2 },
      { name: 'Мёртвый канал', description: null, tags: [], layer: 'culture', kind: 'telegram', url: 'https://t.me/s/example', week: 0, total: 0, last_published: null, posts: 0 },
    ],
  }),
  '/api/social': () => ({
    items: [
      { item_id: 10, kind: 'video', platform: 'tiktok', author: '@someone', analysis: { summary: 'Ролик про балетки', caption: 'ballet flats', hashtags: ['#balletflats'] }, sound: 'Исполнитель — Песня', duration: 14, created_at: daysAgo(1), title: 'TikTok @someone', frames: 2, terms: [{ id: 2, display: 'балетки', kind: 'item' }], post_id: 1 },
      { item_id: 11, kind: 'screenshot', platform: null, author: null, analysis: null, sound: null, duration: null, created_at: daysAgo(2), title: 'Скриншот', frames: 0, terms: [], post_id: null },
    ],
    platforms: ['tiktok'],
  }),
  '/api/trends': (url) => (url.searchParams.get('q')
    ? { found: [trend(2)], rising: [], top: [], fading: [], kinds: KINDS, categories: CATEGORIES }
    : { rising: [trend(2)], top: [trend(1), trend(2)], fading: [trend(3, { week: 0, prev_week: 4 })], kinds: KINDS, categories: CATEGORIES }),
  '/api/trends/:id': () => ({
    term: { id: 2, term: 'ballet flats', display: 'балетки', kind: 'item', category: 'обувь', first_seen: daysAgo(3), suggestions: ['ballet flats trend'], parent_id: null },
    mentions: [
      { signal: 'press', feed: 'Business of Fashion', region: 'британия', seen_at: daysAgo(1), ref: null, title: 'The return of ballet flats', url: 'https://example.com/a' },
      { signal: 'search', feed: null, region: 'сша', seen_at: daysAgo(2), ref: 'ballet flats', title: null, url: null },
    ],
    models: [{ id: 5, display: 'Alaïa', mentions: 3 }],
    parent: null,
  }),
  '/api/schedule': () => ({
    slots: [
      { date: day(0), hour: 19, format_key: FORMATS[0].key, format_title: FORMATS[0].title, week: 1, weekday: 1, post: { id: 2, text: 'Пост в очереди', format: FORMATS[0].key, image_url: null, thesis: 'Тезис' }, matched: true, no_format: false },
      { date: day(1), hour: 10, format_key: FORMATS[1].key, format_title: FORMATS[1].title, week: 1, weekday: 2, post: null },
    ],
    published: [{ id: 3, text: 'Вышедший пост', format: FORMATS[0].key, image_url: null, published_at: daysAgo(1), channel_message_id: 42, date: day(-1) }],
    queue_left: 0,
    publish_hours: [10, 19],
    timezone: 'Europe/Moscow',
  }),
  '/api/assembly': () => ({ steps: STEPS, variables: VARIABLES }),
  '/api/formats': () => ({ formats: FORMATS.map(({ key, title, week, day: d, idea }) => ({ key, title, week, day: d, idea })) }),
  // ответы на действия: важен только код, тело страницы не читают
  'POST /api/posts/:id/:op': () => ({ ok: true }),
  'POST /api/posts/format-all': () => ({ ok: true, detected: 0 }),
  'POST /api/social/:id/draft': () => ({ ok: true, pending: true }),
  'POST /api/trends/:id/draft': () => ({ ok: true, pending: true, items: 1 }),
};

// Бэкенд игры (backend/src/routes): страница ходит к нему напрямую из браузера (NEXT_PUBLIC_API_URL)
const img = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
const gameRows = (lang) => [1, 2, 3, 4, 5].map((i) => ({
  theme: lang === 'ru' ? `Слой ${i}` : `Layer ${i}`,
  options: ['плащ', 'балетки', 'жемчуг', 'кроссовки'],
  correct: 'кроссовки',
  explanation: lang === 'ru' ? 'Объяснение' : 'Explanation',
}));
const aesthetics = { top: [{ name: 'Cocktail Party Outfit Ideas', score: 0.9 }, { name: 'Gala & Formal Dresses', score: 0.6 }], analyzed_at: daysAgo(4) };
const analytics = { impressions: 120, pin_clicks: 4, outbound_clicks: 2, saves: 7 };
const outfit = (id, extra = {}) => ({
  id,
  image_url: img,
  thumb_url: img,
  title: 'Тренч и балетки',
  title_en: 'Trench and ballet flats',
  created_at: daysAgo(10),
  file_hash: 'abc',
  pinterest_exported: false,
  sketch_pin_id: null,
  sketch_pin_analytics: null,
  sketch_pin_analytics_updated_at: null,
  translations: {
    ru: { status: 'ready', error_msg: null, game_rows: gameRows('ru') },
    en: { status: 'error', error_msg: 'overloaded', game_rows: null },
  },
  renders: [{
    id: 'r1', image_url: img, thumb_url: img, aesthetics, pinterest_exported_at: null,
    pin_title: 'Trench and ballet flats', pin_description: 'Описание пина', pinterest_pin_id: '123',
    pinterest_analytics: analytics, pinterest_analytics_updated_at: daysAgo(1), model_appearance: null,
  }],
  svg_layers: [
    { id: 's1', label: 'плащ', label_en: 'trench', svg_url: img, sort_order: 0, is_wrong: false, wrong_reason: null, wrong_reason_en: null, wrong_source: null },
    { id: 's2', label: 'кроссовки', label_en: 'sneakers', svg_url: img, sort_order: 1, is_wrong: true, wrong_reason: 'не тот регистр', wrong_reason_en: 'wrong register', wrong_source: 'ai' },
  ],
  ...extra,
});

export const backend = {
  '/api/admin/outfits': () => ({
    outfits: [
      outfit('11111111-aaaa-bbbb-cccc-000000000001', { sketch_pin_id: '456', sketch_pin_analytics: analytics, pinterest_exported: true }),
      outfit('11111111-aaaa-bbbb-cccc-000000000002', { title: null, title_en: null, translations: null, renders: [], svg_layers: [] }),
    ],
  }),
  '/api/admin/brand/logo': () => ({ logo: { url: img, publicId: 'brand/logo', version: 1, width: 200, height: 80 } }),
  '/api/admin/stats': () => ({
    stats: [
      { id: '11111111-aaaa-bbbb-cccc-000000000001', title: 'Тренч и балетки', thumb_url: img, plays: 12, unique_players: 9, avg_score: '3.4', total: 5, rows: [{ row_index: 0, accuracy: 80, plays: 12 }, { row_index: 1, accuracy: 35, plays: 12 }], devices: { mobile: 8, desktop: 4 } },
      { id: '11111111-aaaa-bbbb-cccc-000000000002', title: null, thumb_url: img, plays: 0, unique_players: 0, avg_score: null, total: null, rows: [], devices: {} },
    ],
  }),
  '/api/admin/coverage': () => ({ renders: [{ id: 'r1', image_url: img, thumb_url: img, aesthetics, outfit_id: '11111111-aaaa-bbbb-cccc-000000000001', title: 'Тренч и балетки', outfit_thumb: img }] }),
  '/api/admin/mechanic-screenshots': () => ({ screenshots: { odd_one_out: [{ id: 1, mechanic_key: 'odd_one_out', image_url: img, created_at: daysAgo(3) }] } }),
  '/api/admin/pinterest-audience': () => ({ reports: [], strategy: null }),
};

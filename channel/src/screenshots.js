const { pool } = require('./db');
const { call, MODELS } = require('./llm');
const { saveEntities, KINDS } = require('./trends');

// Скриншоты из соцсетей (TikTok, Reels, Pinterest…), которые автор присылает боту:
// модель со зрением читает подпись, хэштеги, звук, счётчики и что показано в кадре

const FEED = 'Скриншоты соцсетей';

const SCREENSHOT_SYSTEM = `Ты аналитик модных трендов. Тебе присылают скриншот из соцсети — чаще всего TikTok, иногда Instagram Reels, YouTube Shorts или Pinterest. Прочитай всё, что видно, и опиши:
- platform — площадка (TikTok, Instagram, YouTube, Pinterest, другое);
- author — ник автора, если виден;
- caption — подпись к ролику дословно, если видна;
- hashtags — хэштеги без #;
- sound — название звука или трека, если видно;
- views, likes, comments — счётчики как написано («1,2 млн», «48,3K»), пустая строка, если не видно;
- shows — что показано в кадре: одежда, силуэты, цвета, материалы, обстановка, одна-три фразы по-русски;
- is_fashion — относится ли ролик к моде, стилю, одежде, красоте;
- entities — модные сущности для отслеживания трендов, не больше 6: term (канон в нижнем регистре; для мировых явлений по-английски — «quiet luxury», «balletcore», «dupe»), display, kind.

Не выдумывай то, чего на скриншоте нет: не видно счётчика — пустая строка.`;

const SCREENSHOT_SCHEMA = {
  type: 'object',
  properties: {
    platform: { type: 'string' },
    author: { type: 'string' },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    sound: { type: 'string' },
    views: { type: 'string' },
    likes: { type: 'string' },
    comments: { type: 'string' },
    shows: { type: 'string' },
    is_fashion: { type: 'boolean' },
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
  required: ['platform', 'author', 'caption', 'hashtags', 'sound', 'views', 'likes', 'comments', 'shows', 'is_fashion', 'entities'],
  additionalProperties: false,
};

async function analyzeScreenshot(image, note = '') {
  return call({
    model: MODELS.smart,
    system: SCREENSHOT_SYSTEM,
    user: note ? `Комментарий автора канала к скриншоту: ${note}` : 'Разбери скриншот.',
    schema: SCREENSHOT_SCHEMA,
    images: [image],
    maxTokens: 3000,
  });
}

// Сохранить разбор как заметку (её можно превратить в пост) и как упоминания трендов
async function saveScreenshot(a, fileUniqueId, note = '') {
  const tags = a.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  const stats = [a.views && `просмотры ${a.views}`, a.likes && `лайки ${a.likes}`, a.comments && `комментарии ${a.comments}`].filter(Boolean).join(', ');
  const title = (a.caption || a.shows || 'Скриншот').split('\n')[0].slice(0, 200);
  const summary = [
    a.shows,
    tags && `Хэштеги: ${tags}`,
    a.sound && `Звук: ${a.sound}`,
    stats && `Счётчики: ${stats}`,
    a.author && `Автор: ${a.author}`,
    note && `Комментарий автора канала: ${note}`,
  ].filter(Boolean).map((p) => String(p).trim().replace(/[.。]+$/, '')).join('. ').slice(0, 1500);

  const { rows: [item] } = await pool.query(
    `INSERT INTO items (source, feed, layer, url, title, summary, published_at, trends_done)
     VALUES ($1, $2, 'culture', $3, $4, $5, NOW(), TRUE)
     ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary
     RETURNING id, feed, published_at, fetched_at`,
    [a.platform || 'Соцсети', FEED, `screenshot:${fileUniqueId}`, title, summary]
  );
  await saveEntities(item, a.entities, 'screenshot');
  return item.id;
}

module.exports = { analyzeScreenshot, saveScreenshot, FEED };

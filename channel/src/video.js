const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pool } = require('./db');
const { call, MODELS } = require('./llm');
const { saveEntities, upsertTerm, addMention, KINDS } = require('./trends');

// Видео из соцсетей (например, скачанное другим ботом из TikTok): Claude не принимает видео,
// поэтому режем ролик на кадры равномерно по длительности и отдаём их модели со зрением.
// Звук: у аудиофайла Telegram есть название и исполнитель — это и есть трендовый «звук» TikTok.

const run = promisify(execFile);
const FEED = 'Видео соцсетей';
const FRAMES = 6;

let FFMPEG = null;
try { FFMPEG = require('ffmpeg-static'); } catch { /* без ffmpeg — только обложка от Telegram */ }

async function extractFrames(videoBuf, count = FRAMES) {
  if (!FFMPEG) throw new Error('ffmpeg недоступен');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-'));
  const input = path.join(dir, 'in.mp4');
  fs.writeFileSync(input, videoBuf);
  try {
    // длительность из заголовка ролика
    const probe = await run(FFMPEG, ['-i', input]).catch((e) => e); // ffmpeg без выхода печатает инфо в stderr и «падает»
    const m = String(probe.stderr || '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 10;

    const frames = [];
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) * duration) / count; // середины равных отрезков
      const out = path.join(dir, `f${i}.jpg`);
      await run(FFMPEG, ['-ss', t.toFixed(2), '-i', input, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', '-y', out]);
      if (fs.existsSync(out)) frames.push({ media_type: 'image/jpeg', data: fs.readFileSync(out).toString('base64'), at: t });
    }
    return { frames, duration };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const VIDEO_SYSTEM = `Ты аналитик модных трендов. Тебе присылают кадры ролика из соцсети по порядку — чаще всего TikTok, иногда Reels или Shorts — и, если есть, подпись к нему. Опиши:
- platform — площадка, если можно понять (по интерфейсу на кадрах или по подписи), иначе «TikTok»;
- author — ник автора, если виден;
- caption — подпись или текст на экране, если есть;
- hashtags — хэштеги без #;
- what_happens — что происходит в ролике от начала к концу: смена образов, «до/после», примерка, разбор, приём монтажа — одна-три фразы по-русски;
- shows — что носят: вещи, силуэты, цвета, материалы;
- is_fashion — относится ли ролик к моде, стилю, одежде, красоте;
- entities — модные сущности для отслеживания трендов, не больше 6: term (канон в нижнем регистре; для мировых явлений по-английски), display, kind.
Не выдумывай того, чего не видно.`;

const VIDEO_SCHEMA = {
  type: 'object',
  properties: {
    platform: { type: 'string' },
    author: { type: 'string' },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    what_happens: { type: 'string' },
    shows: { type: 'string' },
    is_fashion: { type: 'boolean' },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          display: { type: 'string' },
          kind: { type: 'string', enum: Object.keys(KINDS).filter((k) => k !== 'sound') },
        },
        required: ['term', 'display', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['platform', 'author', 'caption', 'hashtags', 'what_happens', 'shows', 'is_fashion', 'entities'],
  additionalProperties: false,
};

async function analyzeVideo(frames, note = '') {
  return call({
    model: MODELS.smart,
    system: VIDEO_SYSTEM,
    user: `Кадров: ${frames.length}, по порядку.${note ? `\nПодпись к ролику: ${note}` : ''}`,
    schema: VIDEO_SCHEMA,
    images: frames.map(({ media_type, data }) => ({ media_type, data })),
    maxTokens: 3000,
  });
}

async function saveVideo(a, fileUniqueId, { duration, note } = {}) {
  const tags = a.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  const title = (a.caption || a.what_happens || 'Ролик').split('\n')[0].slice(0, 200);
  const summary = [
    a.what_happens,
    a.shows && `В кадре: ${a.shows}`,
    tags && `Хэштеги: ${tags}`,
    a.author && `Автор: ${a.author}`,
    duration && `Длительность: ${Math.round(duration)} с`,
    note && `Подпись: ${note}`,
  ].filter(Boolean).map((p) => String(p).trim().replace(/[.。]+$/, '')).join('. ').slice(0, 1500);

  const { rows: [item] } = await pool.query(
    `INSERT INTO items (source, feed, layer, url, title, summary, published_at, trends_done)
     VALUES ($1, $2, 'culture', $3, $4, $5, NOW(), TRUE)
     ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary
     RETURNING id, feed, published_at, fetched_at`,
    [a.platform || 'TikTok', FEED, `video:${fileUniqueId}`, title, summary]
  );
  await saveEntities(item, a.entities, 'video');
  return item.id;
}

// Звук ролика: «Исполнитель — Название» как отдельная трендовая сущность
function soundName(audio) {
  const performer = (audio.performer || '').trim();
  const title = (audio.title || audio.file_name || '').replace(/\.(mp3|m4a|aac|ogg|wav)$/i, '').trim();
  if (!performer && !title) return null;
  return performer && title ? `${performer} — ${title}` : performer || title;
}

async function attachSound(itemId, audio) {
  const name = soundName(audio);
  if (!name) return null;
  const termId = await upsertTerm({ term: name, display: name, kind: 'sound' });
  if (!termId) return null;
  const ref = itemId ? `item:${itemId}` : `sound:${audio.file_unique_id}`;
  // звук, пришедший раньше ролика, был записан отдельно — теперь он часть ролика, второй раз не считаем
  if (itemId) await pool.query('DELETE FROM trend_mentions WHERE term_id = $1 AND ref = $2', [termId, `sound:${audio.file_unique_id}`]);
  await addMention(termId, { signal: 'video', ref, itemId: itemId || null, feed: FEED, region: 'соцсети' });
  if (itemId) {
    await pool.query(
      `UPDATE items SET summary = LEFT(COALESCE(summary, '') || $1, 1500) WHERE id = $2 AND COALESCE(summary, '') NOT LIKE '%Звук:%'`,
      [`. Звук: ${name}`, itemId]
    );
  }
  return name;
}

module.exports = { extractFrames, analyzeVideo, saveVideo, attachSound, soundName, FEED, hasFfmpeg: () => Boolean(FFMPEG) };

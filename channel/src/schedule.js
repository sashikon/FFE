const { pool } = require('./db');
const { PUBLISH_HOURS, TZ, localParts, FORMATS } = require('./formats');

// Календарь публикаций: те же правила, что у бота — в слот идёт пост формата дня,
// а если такого нет, самый старый одобренный

const DAY_MS = 24 * 3600 * 1000;

const localDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// Ближайшие слоты публикации на N дней вперёд
function upcomingSlots(days) {
  const now = new Date();
  const slots = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getTime() + i * DAY_MS);
    const { week, day: weekday } = localParts(day);
    const format = FORMATS.find((f) => f.week === week && f.day === weekday) || FORMATS[0];
    for (const hour of PUBLISH_HOURS) {
      if (i === 0 && hour <= localParts(now).hour) continue; // сегодняшние прошедшие слоты
      slots.push({ date: localDate(day), hour, format_key: format.key, format_title: format.title, week, weekday });
    }
  }
  return slots;
}

async function buildSchedule(days = 14) {
  const { rows: queue } = await pool.query(
    `SELECT p.id, p.text, p.format, p.image_url, i.thesis
     FROM posts p JOIN insights i ON i.id = p.insight_id
     WHERE p.status = 'approved' ORDER BY p.approved_at`
  );
  const { rows: published } = await pool.query(
    `SELECT p.id, p.text, p.format, p.image_url, p.published_at, p.channel_message_id
     FROM posts p WHERE p.status = 'published' AND p.published_at > NOW() - INTERVAL '30 days'
     ORDER BY p.published_at`
  );

  const left = [...queue];
  const slots = upcomingSlots(days).map((slot) => {
    if (!left.length) return { ...slot, post: null };
    const idx = left.findIndex((p) => p.format === slot.format_key);
    const [post] = left.splice(idx === -1 ? 0 : idx, 1);
    return { ...slot, post, matched: idx !== -1, no_format: !post.format };
  });

  return {
    slots,
    published: published.map((p) => ({ ...p, date: localDate(new Date(p.published_at)) })),
    queue_left: left.length, // не поместились в показанный период
    publish_hours: PUBLISH_HOURS,
    timezone: TZ,
  };
}

module.exports = { buildSchedule };

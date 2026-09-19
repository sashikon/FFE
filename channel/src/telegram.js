const { pool } = require('./db');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER = process.env.TELEGRAM_OWNER_CHAT_ID;
const CHANNEL = process.env.TELEGRAM_CHANNEL_ID;

class TelegramError extends Error {
  constructor(method, data) {
    super(`Telegram ${method}: ${data.description}`);
    this.code = data.error_code;
  }
}

async function api(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new TelegramError(method, data);
  return data.result;
}

const isParseError = (e) => e instanceof TelegramError && /parse entities/i.test(e.message);
const stripTags = (html) => html.replace(/<[^>]+>/g, '');

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendHtml(chatId, text, extra = {}) {
  try {
    return await api('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra,
    });
  } catch (e) {
    if (!isParseError(e)) throw e;
    // Модель сломала разметку — показываем как есть, чтобы черновик не потерялся
    return api('sendMessage', { chat_id: chatId, text: `⚠️ разметка сломана\n\n${stripTags(text)}`, ...extra });
  }
}

function reviewKeyboard(postId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ В очередь', callback_data: `approve:${postId}` },
        { text: '🚀 Сейчас', callback_data: `now:${postId}` },
      ],
      [
        { text: '✏️ Править', callback_data: `edit:${postId}` },
        { text: '⏸ Отложить', callback_data: `defer:${postId}` },
        { text: '✖️ Удалить', callback_data: `reject:${postId}` },
      ],
    ],
  };
}

async function sendReview(postId) {
  const { rows: [p] } = await pool.query(
    `SELECT p.text, i.lens, i.thesis, c.score
     FROM posts p JOIN insights i ON i.id = p.insight_id JOIN clusters c ON c.id = i.cluster_id
     WHERE p.id = $1`,
    [postId]
  );
  const meta = `\n\n———\n<i>#${postId} · ${p.lens} · оценка ${p.score}\n${escapeHtml(p.thesis)}</i>`;
  const msg = await sendHtml(OWNER, p.text + meta, { reply_markup: reviewKeyboard(postId) });
  await pool.query('UPDATE posts SET review_message_id = $1 WHERE id = $2', [msg.message_id, postId]);
}

// Заменить кнопки под черновиком на строку статуса
async function markReviewed(postId, label) {
  const { rows: [p] } = await pool.query('SELECT review_message_id FROM posts WHERE id = $1', [postId]);
  if (!p?.review_message_id) return;
  await api('editMessageReplyMarkup', {
    chat_id: OWNER,
    message_id: p.review_message_id,
    reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'noop' }]] },
  }).catch(() => {});
}

async function publish(postId) {
  const { rows: [p] } = await pool.query('SELECT text FROM posts WHERE id = $1', [postId]);
  const msg = await api('sendMessage', {
    chat_id: CHANNEL, text: p.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
  });
  await pool.query(
    `UPDATE posts SET status = 'published', published_at = NOW(), channel_message_id = $1 WHERE id = $2`,
    [msg.message_id, postId]
  );
  await markReviewed(postId, '📣 Опубликован');
}

// Черновики, которые не удалось доставить (владелец был недоступен) — дослать
async function resendUndelivered() {
  const { rows } = await pool.query(
    `SELECT id FROM posts WHERE status = 'draft' AND review_message_id IS NULL ORDER BY id`
  );
  for (const r of rows) await sendReview(r.id);
  return rows.length;
}

// Проверка связи перед тратой на модель: webhook перехватывает сообщения, а неверный OWNER — черновики
async function checkTelegram() {
  const hook = await api('getWebhookInfo');
  if (hook.url) {
    return `у бота включён webhook (${new URL(hook.url).host}) — сообщения уходят туда. Удалите его или возьмите новый бот`;
  }
  if (!OWNER) return 'TELEGRAM_OWNER_CHAT_ID пуст: напишите боту /start, чтобы узнать свой id';
  try {
    await api('sendChatAction', { chat_id: OWNER, action: 'typing' });
  } catch (e) {
    return `не могу написать владельцу ${OWNER}: ${e.message}. Проверьте TELEGRAM_OWNER_CHAT_ID и что вы нажали Start в чате с ботом`;
  }
  return null;
}

module.exports = {
  api, sendHtml, sendReview, markReviewed, publish, escapeHtml, resendUndelivered, checkTelegram, TelegramError, OWNER,
};

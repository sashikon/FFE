const { pool } = require('./db');
const { formatByKey } = require('./formats');
const { findSlop } = require('./slop');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER = process.env.TELEGRAM_OWNER_CHAT_ID;
// В значение легко попадает тире вместо минуса или пробелы — приводим к виду, который понимает Telegram
function normalizeChannel(raw) {
  const value = String(raw || '').trim().replace(/[\u2012-\u2015\u2212]/g, '-').replace(/\s+/g, '');
  if (!value) return '';
  if (/^-?\d+$/.test(value)) {
    const digits = value.replace('-', '');
    return digits.startsWith('100') ? `-${digits}` : value; // id каналов всегда начинается с -100
  }
  return value.startsWith('@') || value.startsWith('http') ? value : `@${value}`;
}

const CHANNEL = normalizeChannel(process.env.TELEGRAM_CHANNEL_ID);

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

// Слоган канала ставится кодом при показе и публикации (а не хранится в тексте),
// поэтому смена style/signature.txt сразу действует и на посты в очереди
const fs = require('fs');
const path = require('path');
const SIGNATURE_FILE = path.join(__dirname, '..', 'style', 'signature.txt');
const FOOTER_MARK = '\n\n<i>По материалам:';

function withSignature(text) {
  let signature = '';
  try { signature = fs.readFileSync(SIGNATURE_FILE, 'utf8').trim(); } catch { /* файла нет — без слогана */ }
  if (!signature) return text;
  const line = `\n\n<i>${escapeHtml(signature)}</i>`;
  const i = text.indexOf(FOOTER_MARK);
  return i === -1 ? text + line : text.slice(0, i) + line + text.slice(i);
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

// Картинка — крупным превью над текстом: подпись к фото ограничена 1024 знаками, посты длиннее
const previewFor = (imageUrl) => (imageUrl
  ? { link_preview_options: { url: imageUrl, prefer_large_media: true, show_above_text: true } }
  : {});

function reviewKeyboard(postId, hasImage) {
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
      ...(hasImage ? [[{ text: '🖼 Убрать картинку', callback_data: `noimg:${postId}` }]] : []),
    ],
  };
}

async function sendReview(postId) {
  const { rows: [p] } = await pool.query(
    `SELECT p.text, p.format, p.image_url, i.lens, i.thesis, c.score
     FROM posts p JOIN insights i ON i.id = p.insight_id JOIN clusters c ON c.id = i.cluster_id
     WHERE p.id = $1`,
    [postId]
  );
  const formatTitle = formatByKey(p.format)?.title ?? '—';
  const slop = findSlop(p.text);
  const slopLine = slop.length
    ? `\n⚠️ шаблоны: ${slop.slice(0, 5).map((h) => `«${escapeHtml(h.match)}»`).join(', ')}${slop.length > 5 ? ` и ещё ${slop.length - 5}` : ''}`
    : '';
  const meta = `\n\n———\n<i>#${postId} · ${formatTitle} · ${p.lens} · оценка ${p.score}\n${escapeHtml(p.thesis)}${slopLine}</i>`;
  const msg = await sendHtml(OWNER, withSignature(p.text) + meta, {
    reply_markup: reviewKeyboard(postId, Boolean(p.image_url)),
    ...previewFor(p.image_url),
  });
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
  const { rows: [p] } = await pool.query('SELECT text, image_url FROM posts WHERE id = $1', [postId]);
  const msg = await api('sendMessage', {
    chat_id: CHANNEL, text: withSignature(p.text), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...previewFor(p.image_url),
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

// Что именно бот видит на месте канала: id, имя и его собственные права
async function channelInfo() {
  const raw = { configured: CHANNEL || null };
  try {
    const chat = await api('getChat', { chat_id: CHANNEL });
    raw.chat = { id: chat.id, title: chat.title, username: chat.username || null, type: chat.type };
  } catch (e) {
    raw.chatError = e.message;
    return raw;
  }
  try {
    const me = await api('getMe');
    raw.bot = { id: me.id, username: me.username };
    const member = await api('getChatMember', { chat_id: CHANNEL, user_id: me.id });
    raw.member = { status: member.status, can_post_messages: member.can_post_messages ?? null };
  } catch (e) {
    raw.memberError = e.message;
  }
  return raw;
}

// Самопроверка канала публикации: находится ли он и может ли бот в нём публиковать.
// Возвращает { ok, title, problem } — problem человекочитаемо, с подсказкой, как исправить
async function checkChannel() {
  if (!CHANNEL) return { ok: false, problem: 'TELEGRAM_CHANNEL_ID не задан' };
  let chat;
  try {
    chat = await api('getChat', { chat_id: CHANNEL });
  } catch (e) {
    const hint = String(CHANNEL).startsWith('@')
      ? 'Проверьте, что это имя из ссылки t.me/имя публичного канала (не название). Если канал приватный — нужен числовой id вида -100…: перешлите пост из канала боту @userinfobot.'
      : 'Проверьте id канала (вида -100…) и что бот добавлен в канал администратором.';
    return { ok: false, problem: `канал ${CHANNEL} не найден (${e.message.replace(/^Telegram \w+: /, '')}). ${hint}` };
  }
  const title = chat.title || String(CHANNEL);
  try {
    const me = await api('getMe');
    const member = await api('getChatMember', { chat_id: CHANNEL, user_id: me.id });
    const canPost = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false);
    if (!canPost) {
      return { ok: false, title, problem: `бот не может публиковать в «${title}»: он не администратор или у него выключено право «Публикация сообщений». Канал → Управление каналом → Администраторы → бот → включите право.` };
    }
  } catch (e) {
    return { ok: false, title, problem: `не удалось проверить права бота в «${title}»: ${e.message}. Добавьте бота в администраторы канала.` };
  }
  return { ok: true, title };
}

module.exports = {
  normalizeChannel,
  api, sendHtml, sendReview, markReviewed, publish, escapeHtml, resendUndelivered, checkTelegram, checkChannel, channelInfo, TelegramError, OWNER,
};

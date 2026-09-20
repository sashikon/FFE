const { pool } = require('./db');
const tg = require('./telegram');
const { redraft } = require('./pipeline');
const { learnFromFeedback } = require('./learn');

// Действия с постом — общие для бота и админки игры. via: 'bot' | 'admin'.
// Из админки черновик в Telegram помечается, чтобы по его старым кнопкам нельзя было выпустить устаревшую версию

// Какие действия допустимы в каком статусе
const ALLOWED = {
  approve: ['draft', 'deferred'],
  now: ['draft', 'deferred', 'approved'],
  defer: ['draft', 'deferred', 'approved'],
  reject: ['draft', 'deferred', 'approved'],
  noimg: ['draft', 'deferred', 'approved'],
  image: ['draft', 'deferred', 'approved'],
  edit: ['draft', 'deferred', 'approved'],
  redraft: ['draft', 'deferred', 'approved'],
};

class ActionError extends Error {}

const STATUS_RU = {
  draft: 'не утверждён', approved: 'в очереди', published: 'опубликован', deferred: 'отложен',
  rejected: 'удалён', superseded: 'заменён новой версией',
};

async function checkStatus(postId, action) {
  const { rows: [p] } = await pool.query('SELECT status FROM posts WHERE id = $1', [postId]);
  if (!p) throw new ActionError('Пост не найден');
  if (!ALLOWED[action].includes(p.status)) throw new ActionError(`Нельзя: пост ${STATUS_RU[p.status] || p.status}`);
  return p.status;
}

const suffix = (via) => (via === 'admin' ? ' (из админки)' : '');

// Прислать в бот актуальную версию черновика, а старое сообщение пометить
async function refreshReview(postId, label) {
  await tg.markReviewed(postId, label);
  await pool.query('UPDATE posts SET review_message_id = NULL WHERE id = $1', [postId]);
  await tg.sendReview(postId);
}

async function approve(postId, via = 'bot') {
  await checkStatus(postId, 'approve');
  await pool.query(`UPDATE posts SET status = 'approved', approved_at = NOW() WHERE id = $1`, [postId]);
  await tg.markReviewed(postId, `✅ В очереди${suffix(via)}`);
}

async function publishNow(postId) {
  await checkStatus(postId, 'now');
  try {
    await tg.publish(postId);
  } catch (e) {
    const channel = await tg.checkChannel().catch(() => ({ ok: true }));
    throw new ActionError(channel.ok ? `Telegram не принял публикацию: ${e.message}` : `Не опубликовано: ${channel.problem}`);
  }
}

async function defer(postId, via = 'bot') {
  await checkStatus(postId, 'defer');
  await pool.query(`UPDATE posts SET status = 'deferred' WHERE id = $1`, [postId]);
  await tg.markReviewed(postId, `⏸ Отложен${suffix(via)}`);
}

async function reject(postId, via = 'bot') {
  await checkStatus(postId, 'reject');
  await pool.query(`UPDATE posts SET status = 'rejected' WHERE id = $1`, [postId]);
  await tg.markReviewed(postId, `✖️ Удалён${suffix(via)}`);
}

async function removeImage(postId, via = 'bot') {
  const status = await checkStatus(postId, 'noimg');
  await pool.query('UPDATE posts SET image_url = NULL, image_ref = NULL WHERE id = $1', [postId]);
  if (status !== 'approved') await refreshReview(postId, `🖼 Без картинки${suffix(via)} — см. ниже`);
}

// Выбор картинки из библиотеки образов игры (из админки). outfitId = null — без картинки
async function setImage(postId, outfitId, via = 'admin') {
  const status = await checkStatus(postId, 'image');
  if (!outfitId) {
    await pool.query('UPDATE posts SET image_url = NULL, image_ref = NULL WHERE id = $1', [postId]);
  } else {
    const { rows: [outfit] } = await pool.query('SELECT image_url FROM library WHERE outfit_id = $1', [outfitId]);
    if (!outfit) throw new ActionError('Образ не найден в библиотеке');
    await pool.query('UPDATE posts SET image_url = $1, image_ref = $2 WHERE id = $3', [outfit.image_url, outfitId, postId]);
  }
  if (status !== 'approved') await refreshReview(postId, `🖼 Картинка изменена${suffix(via)} — см. ниже`);
}

// Ручная правка текста (только из админки): статус не меняется, пост в очереди остаётся в очереди
async function editText(postId, text) {
  const status = await checkStatus(postId, 'edit');
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) throw new ActionError('Текст пустой');
  if (clean.length > 3800) throw new ActionError(`Слишком длинно для Telegram: ${clean.length} знаков из 3800`);
  await pool.query('UPDATE posts SET text = $1 WHERE id = $2', [clean, postId]);
  if (status !== 'approved') await refreshReview(postId, '✏️ Изменён в админке — см. ниже');
}

// Правка через модель по комментарию + память правок. Долго — вызывающий не ждёт завершения
async function redraftWithFeedback(postId, feedback, via = 'bot') {
  await checkStatus(postId, 'redraft');
  const comment = String(feedback || '').trim();
  if (!comment) throw new ActionError('Комментарий пустой');
  const { rows: [before] } = await pool.query('SELECT text, status FROM posts WHERE id = $1', [postId]);
  await tg.markReviewed(postId, `✏️ Переписывается${suffix(via)}`);
  if (via === 'admin') {
    const queued = before.status === 'approved' ? ' Пост снят из очереди.' : '';
    await tg.sendHtml(tg.OWNER, `✏️ Правка из админки: <i>${tg.escapeHtml(comment)}</i>.${queued} Новая версия придёт следующим сообщением.`);
  }
  const newId = await redraft(postId, comment);
  learnFromFeedback(postId, before.text, comment)
    .then((learned) => learned && tg.sendHtml(tg.OWNER, `🧠 Запомнено на будущее: <i>${tg.escapeHtml(learned.rule)}</i>`, learned.id ? {
      reply_markup: { inline_keyboard: [[{ text: '✖️ Не запоминать', callback_data: `delrule:${learned.id}` }]] },
    } : {}))
    .catch((e) => console.warn(`[learn] failed: ${e.message}`));
  return newId;
}

module.exports = { ActionError, approve, publishNow, defer, reject, removeImage, setImage, editText, redraftWithFeedback };

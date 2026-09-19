const { pool, getState, setState } = require('./db');
const tg = require('./telegram');
const { runPipeline, redraft } = require('./pipeline');
const { FORMATS, formatToday } = require('./formats');

const HELP = `Команды:
/run — собрать ленту и подготовить черновики сейчас
/queue — что в очереди на публикацию
/deferred — вернуть отложенные черновики
/formats — расписание форматов
/cancel — отменить ожидание правки`;

async function onCallback(q) {
  const [action, rawId] = q.data.split(':');
  const postId = Number(rawId);
  await tg.api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  if (action === 'noop') return;

  const { rows: [post] } = await pool.query('SELECT status FROM posts WHERE id = $1', [postId]);
  if (!post || !['draft', 'deferred'].includes(post.status)) return;

  switch (action) {
    case 'approve':
      await pool.query(`UPDATE posts SET status = 'approved', approved_at = NOW() WHERE id = $1`, [postId]);
      await tg.markReviewed(postId, '✅ В очереди');
      break;
    case 'now':
      await tg.publish(postId);
      break;
    case 'defer':
      await pool.query(`UPDATE posts SET status = 'deferred' WHERE id = $1`, [postId]);
      await tg.markReviewed(postId, '⏸ Отложен');
      break;
    case 'reject':
      await pool.query(`UPDATE posts SET status = 'rejected' WHERE id = $1`, [postId]);
      await tg.markReviewed(postId, '✖️ Удалён');
      break;
    case 'noimg':
      await pool.query('UPDATE posts SET image_url = NULL, image_ref = NULL WHERE id = $1', [postId]);
      await tg.markReviewed(postId, '🖼 Без картинки — см. ниже');
      await pool.query('UPDATE posts SET review_message_id = NULL WHERE id = $1', [postId]);
      await tg.sendReview(postId);
      break;
    case 'edit':
      await setState('awaiting_feedback', postId);
      await tg.sendHtml(tg.OWNER, `Что поправить в #${postId}? Напишите одним сообщением.`);
      break;
  }
}

async function onMessage(msg) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  // Не-владельцу на /start отвечаем его id — так проще всего найти ошибку в TELEGRAM_OWNER_CHAT_ID
  if (!tg.OWNER || chatId !== String(tg.OWNER)) {
    console.log(`[bot] message from ${chatId} (owner: ${tg.OWNER || 'not set'})`);
    if (text.startsWith('/start')) {
      await tg.api('sendMessage', {
        chat_id: chatId,
        text: `Ваш chat id: ${chatId}\nВпишите его в TELEGRAM_OWNER_CHAT_ID и перезапустите сервис.`,
      });
    }
    return;
  }

  if (text === '/start' || text === '/help') return tg.sendHtml(chatId, HELP);

  if (text === '/cancel') {
    await setState('awaiting_feedback', null);
    return tg.sendHtml(chatId, 'Ок, правка отменена.');
  }

  if (text === '/run') {
    await tg.sendHtml(chatId, 'Собираю ленту…');
    const r = await runPipeline();
    return tg.sendHtml(chatId, r.skipped ? 'Прогон уже идёт.' : `Готово: формат «${r.format}», черновиков ${r.drafted} из ${r.candidates} кандидатов.`);
  }

  if (text === '/formats') {
    const days = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const today = formatToday().key;
    const list = [1, 2].map((w) => `<b>Неделя ${w}</b>\n` + FORMATS.filter((f) => f.week === w)
      .map((f) => `${f.key === today ? '▶︎' : '  '} ${days[f.day]} — ${f.title}`).join('\n')).join('\n\n');
    return tg.sendHtml(chatId, list);
  }

  if (text === '/queue') {
    const { rows } = await pool.query(
      `SELECT id, LEFT(text, 60) AS head FROM posts WHERE status = 'approved' ORDER BY approved_at`
    );
    const list = rows.map((r) => `#${r.id} ${tg.escapeHtml(r.head.replace(/<[^>]+>/g, ''))}…`).join('\n');
    return tg.sendHtml(chatId, rows.length ? `В очереди ${rows.length}:\n${list}` : 'Очередь пуста.');
  }

  if (text === '/deferred') {
    const { rows } = await pool.query(`SELECT id FROM posts WHERE status = 'deferred' ORDER BY id`);
    if (!rows.length) return tg.sendHtml(chatId, 'Отложенных нет.');
    for (const r of rows) await tg.sendReview(r.id);
    return;
  }

  const awaiting = await getState('awaiting_feedback');
  if (awaiting && text && !text.startsWith('/')) {
    await setState('awaiting_feedback', null);
    await tg.markReviewed(awaiting, '✏️ Переписывается');
    await tg.sendHtml(chatId, 'Переписываю…');
    await redraft(awaiting, text);
  }
}

async function poll() {
  let offset = (await getState('tg_offset')) || 0;
  for (;;) {
    try {
      const updates = await tg.api('getUpdates', {
        offset, timeout: 30, allowed_updates: ['message', 'callback_query'],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        await setState('tg_offset', offset);
        try {
          if (u.callback_query) await onCallback(u.callback_query);
          else if (u.message) await onMessage(u.message);
        } catch (e) {
          console.error('[bot] handler error', e);
          await tg.sendHtml(tg.OWNER, `Ошибка: ${tg.escapeHtml(e.message)}`).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[bot] poll error', e.message);
      // при webhook ошибка не пройдёт сама — не засоряем лог каждые 5 секунд
      await new Promise((r) => setTimeout(r, /webhook/.test(e.message) ? 60_000 : 5000));
    }
  }
}

module.exports = { poll };

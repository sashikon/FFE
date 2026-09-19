const { pool, getState, setState } = require('./db');
const tg = require('./telegram');
const { runPipeline, redraft } = require('./pipeline');
const { FORMATS, PUBLISH_HOURS, localParts, formatToday, formatForNextSlot, formatByKey } = require('./formats');

const DAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const stripTags = (html) => html.replace(/<[^>]+>/g, '');

// ─── Команды ─────────────────────────────────────────────────────────────────
// Одни и те же действия вызываются и командой (/status), и кнопкой меню (menu:status)

async function cmdStatus(chatId) {
  const now = new Date();
  const { week, day, hour } = localParts(now);
  const nextHour = PUBLISH_HOURS.find((h) => h > hour);
  const slot = nextHour !== undefined ? `сегодня в ${nextHour}:00` : `завтра в ${PUBLISH_HOURS[0]}:00`;

  const { rows: [c] } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE status = 'approved')::int AS queue,
           COUNT(*) FILTER (WHERE status = 'draft')::int AS pending,
           COUNT(*) FILTER (WHERE status = 'deferred')::int AS deferred,
           COUNT(*) FILTER (WHERE status = 'published' AND published_at > NOW() - INTERVAL '7 days')::int AS week_published
    FROM posts`);
  const last = await getState('last_pipeline_at');
  const lastRun = last
    ? new Date(last).toLocaleString('ru-RU', { timeZone: process.env.TZ || 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'ещё не было';

  return tg.sendHtml(chatId, [
    `<b>Сегодня</b>: неделя ${week}, ${DAYS[day]} — «${formatToday(now).title}»`,
    `<b>Ближайшая публикация</b>: ${slot}, формат черновиков — «${formatForNextSlot(now).title}»`,
    '',
    `✅ В очереди: ${c.queue}`,
    `📝 Не утверждено: ${c.pending}`,
    `⏸ Отложено: ${c.deferred}`,
    `📣 Опубликовано за 7 дней: ${c.week_published}`,
    '',
    `Последний прогон: ${lastRun}`,
  ].join('\n'));
}

// Прогон идёт минуты — запускаем в фоне, чтобы бот не замолкал на это время
async function cmdRun(chatId) {
  await tg.sendHtml(chatId, 'Собираю ленту и готовлю черновики — это займёт несколько минут. Бот тем временем отвечает на кнопки.');
  runPipeline()
    .then((r) => tg.sendHtml(chatId, r.skipped
      ? 'Прогон уже идёт.'
      : `Готово: формат «${r.format}», черновиков ${r.drafted} из ${r.candidates} кандидатов.`))
    .catch((e) => tg.sendHtml(chatId, `Прогон упал: ${tg.escapeHtml(e.message)}`).catch(() => {}));
}

// Ответ на сообщение черновика: в Telegram над ответом видна цитата, по нажатию — переход к посту
async function draftRef(postId) {
  const { rows: [p] } = await pool.query('SELECT text, review_message_id FROM posts WHERE id = $1', [postId]);
  if (!p) return { head: `#${postId}`, extra: {} };
  const head = stripTags(p.text).split('\n')[0].slice(0, 80);
  const extra = p.review_message_id
    ? { reply_parameters: { message_id: Number(p.review_message_id), allow_sending_without_reply: true } }
    : {};
  return { head, extra };
}

async function startRedraft(chatId, postId, feedback) {
  await setState('awaiting_feedback', null);
  const { extra } = await draftRef(postId);
  await tg.markReviewed(postId, '✏️ Переписывается');
  await tg.sendHtml(chatId, 'Переписываю — новая версия придёт следующим сообщением…', extra);
  await redraft(postId, feedback);
}

const hoursAgo = (date) => {
  const h = Math.floor((Date.now() - new Date(date).getTime()) / 3600e3);
  return h < 1 ? 'меньше часа' : `${h} ч`;
};

// Обзор неутверждённых черновиков: заголовок, формат, сколько ждёт + кнопки «Открыть»
async function cmdPending(chatId) {
  const { rows } = await pool.query(
    `SELECT id, text, format, created_at FROM posts WHERE status = 'draft' ORDER BY created_at`
  );
  if (!rows.length) return tg.sendHtml(chatId, 'Все черновики разобраны 👌');

  const list = rows.map((r) => {
    const head = stripTags(r.text).split('\n')[0].slice(0, 70);
    const format = formatByKey(r.format)?.title;
    return `<b>#${r.id}</b> ${tg.escapeHtml(head)}\n    ${format ? `${format} · ` : ''}ждёт ${hoursAgo(r.created_at)}`;
  }).join('\n\n');

  const open = rows.slice(0, 12).map((r) => ({ text: `Открыть #${r.id}`, callback_data: `open:${r.id}` }));
  const keyboard = [];
  for (let i = 0; i < open.length; i += 3) keyboard.push(open.slice(i, i + 3));
  keyboard.push([{ text: '📨 Прислать все', callback_data: 'menu:resend' }]);

  return tg.sendHtml(chatId, `<b>Не утверждено: ${rows.length}</b>\n\n${list}`, { reply_markup: { inline_keyboard: keyboard } });
}

// Прислать черновик заново; старую копию помечаем, чтобы в чате не было двух живых копий с кнопками
async function resendDraft(postId) {
  await tg.markReviewed(postId, '↓ Прислан заново ниже');
  await tg.sendReview(postId);
}

async function cmdResendAll(chatId) {
  const { rows } = await pool.query(`SELECT id FROM posts WHERE status = 'draft' ORDER BY created_at`);
  if (!rows.length) return tg.sendHtml(chatId, 'Все черновики разобраны 👌');
  for (const r of rows) await resendDraft(r.id);
}

async function cmdQueue(chatId) {
  const { rows } = await pool.query(
    `SELECT id, LEFT(text, 80) AS head FROM posts WHERE status = 'approved' ORDER BY approved_at`
  );
  const list = rows.map((r) => `#${r.id} ${tg.escapeHtml(stripTags(r.head).split('\n')[0])}…`).join('\n');
  return tg.sendHtml(chatId, rows.length ? `В очереди ${rows.length}:\n${list}` : 'Очередь пуста.');
}

async function cmdDeferred(chatId) {
  const { rows } = await pool.query(`SELECT id FROM posts WHERE status = 'deferred' ORDER BY id`);
  if (!rows.length) return tg.sendHtml(chatId, 'Отложенных нет.');
  for (const r of rows) await tg.sendReview(r.id);
}

async function cmdFormats(chatId) {
  const today = formatToday().key;
  const list = [1, 2].map((w) => `<b>Неделя ${w}</b>\n` + FORMATS.filter((f) => f.week === w)
    .map((f) => `${f.key === today ? '▶︎' : '    '} ${DAYS[f.day]} — ${f.title}`).join('\n')).join('\n\n');
  return tg.sendHtml(chatId, list);
}

async function cmdCancel(chatId) {
  await setState('awaiting_feedback', null);
  return tg.sendHtml(chatId, 'Ок, правка отменена.');
}

const MENU_TEXT = `<b>Канал о смыслах в моде</b>

Черновики приходят сюда сами раз в 6 часов. Под каждым — кнопки: ✅ в очередь · 🚀 сейчас · ✏️ править · ⏸ отложить · ✖️ удалить · 🖼 убрать картинку.
Чтобы поправить пост, можно просто ответить на него (свайп или «Ответить») и написать, что изменить.
Одобренное выходит в канал в ${PUBLISH_HOURS.map((h) => `${h}:00`).join(' и ')}; если черновики ждут решения, я напомню.`;

async function menuKeyboard() {
  const { rows: [c] } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE status = 'draft')::int AS pending,
           COUNT(*) FILTER (WHERE status = 'approved')::int AS queue,
           COUNT(*) FILTER (WHERE status = 'deferred')::int AS deferred
    FROM posts`);
  return {
    inline_keyboard: [
      [{ text: `📝 Не утверждено (${c.pending})`, callback_data: 'menu:pending' }],
      [{ text: `✅ Очередь (${c.queue})`, callback_data: 'menu:queue' }, { text: `⏸ Отложенные (${c.deferred})`, callback_data: 'menu:deferred' }],
      [{ text: '📊 Статус', callback_data: 'menu:status' }, { text: '🗓 Форматы', callback_data: 'menu:formats' }],
      [{ text: '▶️ Прогон сейчас', callback_data: 'menu:run' }],
    ],
  };
}

const cmdMenu = async (chatId) => tg.sendHtml(chatId, MENU_TEXT, { reply_markup: await menuKeyboard() });

// command → [описание для кнопки «Меню» в Telegram, обработчик]
const COMMANDS = {
  menu: ['Меню с кнопками', cmdMenu],
  status: ['Сводка: формат дня, очередь, ждут решения', cmdStatus],
  run: ['Собрать ленту и подготовить черновики сейчас', cmdRun],
  pending: ['Не утверждено: список черновиков', cmdPending],
  resend: ['Прислать заново все неутверждённые', cmdResendAll],
  queue: ['Что в очереди на публикацию', cmdQueue],
  deferred: ['Вернуть отложенные черновики', cmdDeferred],
  formats: ['Расписание форматов на две недели', cmdFormats],
  cancel: ['Отменить ожидание правки', cmdCancel],
};

// Кнопка «Меню» у поля ввода — список команд виден только владельцу
async function setupMenu() {
  await tg.api('deleteMyCommands', {}).catch(() => {});
  await tg.api('setMyCommands', {
    commands: Object.entries(COMMANDS).map(([command, [description]]) => ({ command, description })),
    scope: { type: 'chat', chat_id: Number(tg.OWNER) },
  });
  await tg.api('setChatMenuButton', { chat_id: Number(tg.OWNER), menu_button: { type: 'commands' } });
}

// ─── Обработчики ─────────────────────────────────────────────────────────────

async function onCallback(q) {
  await tg.api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  if (String(q.from?.id) !== String(tg.OWNER)) return;

  const [action, arg] = q.data.split(':');
  if (action === 'noop') return;
  if (action === 'menu') return COMMANDS[arg]?.[1](tg.OWNER);
  if (action === 'open') {
    const { rows: [p] } = await pool.query('SELECT status FROM posts WHERE id = $1', [Number(arg)]);
    if (p && ['draft', 'deferred'].includes(p.status)) return resendDraft(Number(arg));
    const { head, extra } = await draftRef(Number(arg));
    return tg.sendHtml(tg.OWNER, `«${tg.escapeHtml(head)}» уже разобран.`, extra);
  }

  const postId = Number(arg);
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
    case 'edit': {
      await setState('awaiting_feedback', postId);
      const { head, extra } = await draftRef(postId);
      await tg.sendHtml(
        tg.OWNER,
        `✏️ Что поправить в посте «${tg.escapeHtml(head)}»?\nНапишите одним сообщением. Отменить — /cancel.`,
        extra
      );
      break;
    }
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

  const command = text.match(/^\/(\w+)/)?.[1];
  if (command === 'start' || command === 'help') return cmdMenu(chatId);
  if (command && COMMANDS[command]) return COMMANDS[command][1](chatId);

  // «Ответить» на черновик = правка этого черновика, без кнопки «✏️ Править»
  const replyTo = msg.reply_to_message?.message_id;
  if (replyTo && text && !text.startsWith('/')) {
    const { rows: [p] } = await pool.query('SELECT id, status FROM posts WHERE review_message_id = $1', [replyTo]);
    const replyExtra = { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } };
    if (p && ['draft', 'deferred', 'approved'].includes(p.status)) {
      if (p.status === 'approved') {
        await tg.sendHtml(chatId, 'Пост снят из очереди — новая версия придёт на утверждение.', replyExtra);
      }
      return startRedraft(chatId, p.id, text);
    }
    if (p) {
      return tg.sendHtml(chatId, 'Этот пост уже опубликован или удалён — править можно черновики и посты в очереди.', replyExtra);
    }
  }

  const awaiting = await getState('awaiting_feedback');
  if (awaiting && text && !text.startsWith('/')) return startRedraft(chatId, awaiting, text);

  if (text) return cmdMenu(chatId);
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

module.exports = { poll, setupMenu, __test: { onMessage, onCallback } };

const { pool, getState, setState } = require('./db');
const tg = require('./telegram');
const { runPipeline, redraft } = require('./pipeline');
const { FORMATS, PUBLISH_HOURS, localParts, formatToday, formatForNextSlot } = require('./formats');

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
    `🕓 Ждут решения: ${c.pending}`,
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

async function cmdPending(chatId) {
  const { rows } = await pool.query(`SELECT id FROM posts WHERE status = 'draft' ORDER BY created_at`);
  if (!rows.length) return tg.sendHtml(chatId, 'Все черновики разобраны 👌');
  // старые сообщения помечаем, чтобы в чате не было двух живых копий с кнопками
  for (const r of rows) {
    await tg.markReviewed(r.id, '↓ Прислан заново ниже');
    await tg.sendReview(r.id);
  }
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
Одобренное выходит в канал в ${PUBLISH_HOURS.map((h) => `${h}:00`).join(' и ')}; если черновики ждут решения, я напомню.`;

const menuKeyboard = {
  inline_keyboard: [
    [{ text: '📊 Статус', callback_data: 'menu:status' }, { text: '▶️ Прогон сейчас', callback_data: 'menu:run' }],
    [{ text: '🕓 Ждут решения', callback_data: 'menu:pending' }, { text: '✅ Очередь', callback_data: 'menu:queue' }],
    [{ text: '⏸ Отложенные', callback_data: 'menu:deferred' }, { text: '🗓 Форматы', callback_data: 'menu:formats' }],
  ],
};

const cmdMenu = (chatId) => tg.sendHtml(chatId, MENU_TEXT, { reply_markup: menuKeyboard });

// command → [описание для кнопки «Меню» в Telegram, обработчик]
const COMMANDS = {
  menu: ['Меню с кнопками', cmdMenu],
  status: ['Сводка: формат дня, очередь, ждут решения', cmdStatus],
  run: ['Собрать ленту и подготовить черновики сейчас', cmdRun],
  pending: ['Прислать заново черновики без решения', cmdPending],
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

  const command = text.match(/^\/(\w+)/)?.[1];
  if (command === 'start' || command === 'help') return cmdMenu(chatId);
  if (command && COMMANDS[command]) return COMMANDS[command][1](chatId);

  const awaiting = await getState('awaiting_feedback');
  if (awaiting && text && !text.startsWith('/')) {
    await setState('awaiting_feedback', null);
    await tg.markReviewed(awaiting, '✏️ Переписывается');
    await tg.sendHtml(chatId, 'Переписываю…');
    await redraft(awaiting, text);
    return;
  }

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

const { pool, getState, setState } = require('./db');
const tg = require('./telegram');
const { runPipeline, redraft, cleanSlop, draftFromSource, draftFromItem } = require('./pipeline');
const { analyzeScreenshot, saveScreenshot } = require('./screenshots');
const { listTrends, KINDS } = require('./trends');
const { findSlop } = require('./slop');
const { activeRules, addRule, removeRule } = require('./learn');
const actions = require('./actions');
const { FORMATS, PUBLISH_HOURS, localParts, formatToday, formatForNextSlot, formatByKey } = require('./formats');

const DAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const stripTags = (html) => html.replace(/<[^>]+>/g, '');

// «1 пост», «2 поста», «5 постов»
function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} ${one}`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

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
  const channel = await tg.checkChannel().catch((e) => ({ ok: false, problem: e.message }));
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
    channel.ok
      ? `Канал: ✅ «${tg.escapeHtml(channel.title)}» — публиковать можно`
      : `Канал: ❌ ${tg.escapeHtml(channel.problem)}`,
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
  await tg.sendHtml(chatId, 'Переписываю — новая версия придёт следующим сообщением…', extra);
  await actions.redraftWithFeedback(postId, feedback, 'bot');
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

async function cmdRules(chatId) {
  const rules = await activeRules();
  if (!rules.length) {
    return tg.sendHtml(chatId, 'Уроков редактора пока нет. Они появляются из ваших комментариев к правкам. Добавить вручную: /rule текст правила');
  }
  const list = rules.map((r, i) => `${i + 1}. ${tg.escapeHtml(r.rule)}`).join('\n');
  const buttons = rules.map((r, i) => ({ text: `✖️ ${i + 1}`, callback_data: `delrule:${r.id}` }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 5) keyboard.push(buttons.slice(i, i + 5));
  return tg.sendHtml(
    chatId,
    `<b>🧠 Уроки редактора: ${rules.length}</b>\nЭти правила учитываются в каждом новом черновике.\n\n${list}\n\nУбрать правило — кнопка с его номером. Добавить — /rule текст.`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
}

// Проверка очереди и неутверждённых на слоп: отчёт + кнопки «Вычистить»
async function slopReport() {
  const { rows } = await pool.query(
    `SELECT id, text, status FROM posts WHERE status IN ('approved', 'draft') ORDER BY status, id`
  );
  return rows.map((r) => ({ ...r, hits: findSlop(r.text) }));
}

async function cmdCheck(chatId) {
  const report = await slopReport();
  if (!report.length) return tg.sendHtml(chatId, 'Проверять нечего: очередь пуста и неутверждённых черновиков нет.');
  const dirty = report.filter((r) => r.hits.length);
  const lines = report.map((r) => {
    const head = tg.escapeHtml(stripTags(r.text).split('\n')[0].slice(0, 60));
    const where = r.status === 'approved' ? '✅' : '📝';
    if (!r.hits.length) return `${where} <b>#${r.id}</b> ${head}\n    чисто`;
    const found = r.hits.slice(0, 6).map((h) => `«${tg.escapeHtml(h.match)}»`).join(', ');
    return `${where} <b>#${r.id}</b> ${head}\n    ⚠️ ${r.hits.length}: ${found}${r.hits.length > 6 ? '…' : ''}`;
  }).join('\n\n');
  const buttons = dirty.slice(0, 12).map((r) => ({ text: `🧹 Вычистить #${r.id}`, callback_data: `clean:${r.id}` }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  if (dirty.length > 1) keyboard.push([{ text: `🧹 Вычистить все (${dirty.length})`, callback_data: 'menu:cleanall' }]);
  const summary = dirty.length
    ? `Шаблоны найдены в ${dirty.length} из ${report.length}. «Вычистить» переписывает только найденные места; новая версия придёт на утверждение, пост из очереди до этого снимается.`
    : `Все ${report.length} чистые 👌`;
  return tg.sendHtml(chatId, `<b>🧹 Проверка на слоп</b>\n✅ — в очереди, 📝 — не утверждено\n\n${lines}\n\n${summary}`,
    keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {});
}

async function cleanOne(chatId, postId) {
  const { rows: [p] } = await pool.query('SELECT status FROM posts WHERE id = $1', [postId]);
  if (!p || !['approved', 'draft'].includes(p.status)) return tg.sendHtml(chatId, `#${postId} уже не в очереди и не черновик.`);
  if (p.status === 'draft') await tg.markReviewed(postId, '🧹 Вычищается — новая версия ниже');
  const r = await cleanSlop(postId);
  if (!r) return tg.sendHtml(chatId, `#${postId}: шаблонов не нашлось.`);
  return tg.sendHtml(chatId, `🧹 #${postId} → #${r.newId}: исправлено мест: ${r.fixed}${r.left ? `, осталось: ${r.left}` : ''}. Новая версия выше — утвердите её.`);
}

async function cmdCleanAll(chatId) {
  const dirty = (await slopReport()).filter((r) => r.hits.length);
  if (!dirty.length) return tg.sendHtml(chatId, 'Чистить нечего 👌');
  await tg.sendHtml(chatId, `Вычищаю ${dirty.length} — это займёт пару минут. Бот тем временем отвечает на кнопки.`);
  (async () => {
    for (const r of dirty) {
      await cleanOne(chatId, r.id).catch((e) => tg.sendHtml(chatId, `#${r.id}: ошибка — ${tg.escapeHtml(e.message)}`).catch(() => {}));
    }
  })();
}

// Диагностика канала: что бот видит на месте TELEGRAM_CHANNEL_ID
async function cmdChannel(chatId) {
  const i = await tg.channelInfo();
  const lines = [`<b>Канал в настройках:</b> <code>${tg.escapeHtml(String(i.configured))}</code>`];
  if (i.chatError) {
    lines.push(`❌ Не найден: ${tg.escapeHtml(i.chatError)}`);
    lines.push('Проверьте TELEGRAM_CHANNEL_ID: для публичного канала — @имя из ссылки t.me/имя, для приватного — числовой id вида -100… (перешлите пост канала боту @userinfobot).');
  } else {
    lines.push(`<b>Найден:</b> «${tg.escapeHtml(i.chat.title || '')}» · id <code>${i.chat.id}</code>${i.chat.username ? ` · @${i.chat.username}` : ' · приватный'}`);
    if (i.bot) lines.push(`<b>Бот:</b> @${tg.escapeHtml(i.bot.username)}`);
    if (i.memberError) lines.push(`❌ Права проверить не удалось: ${tg.escapeHtml(i.memberError)}`);
    else {
      const ok = i.member.status === 'creator' || (i.member.status === 'administrator' && i.member.can_post_messages !== false);
      lines.push(`<b>Статус бота в канале:</b> ${i.member.status}${i.member.can_post_messages === null ? '' : `, публикация: ${i.member.can_post_messages ? 'разрешена' : 'запрещена'}`}`);
      lines.push(ok ? '✅ Публиковать можно' : '❌ Публиковать нельзя — включите боту право «Публикация сообщений» и нажмите «Сохранить изменения».');
    }
  }
  return tg.sendHtml(chatId, lines.join('\n'));
}

// Проставить формат всем постам, где он не задан
async function cmdSetFormats(chatId) {
  const { rows: [{ n }] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM posts WHERE format IS NULL AND status IN ('draft', 'deferred', 'approved')`
  );
  if (!n) return tg.sendHtml(chatId, 'У всех постов формат уже задан 👌');
  await tg.sendHtml(chatId, `Определяю формат у ${plural(n, 'поста', 'постов', 'постов')}…`);
  actions.detectMissingFormats()
    .then((r) => {
      const list = r.done.map((d) => `#${d.id} → ${d.title}`).join('\n');
      const fails = r.failed.length ? `\n\nНе получилось: ${r.failed.map((f) => `#${f.id} (${tg.escapeHtml(f.error)})`).join(', ')}` : '';
      return tg.sendHtml(chatId, `Готово: ${r.done.length} из ${r.total}\n${tg.escapeHtml(list)}${fails}`);
    })
    .catch((e) => tg.sendHtml(chatId, `Не получилось: ${tg.escapeHtml(e.message)}`).catch(() => {}));
}

async function cmdCancel(chatId) {
  await setState('awaiting_feedback', null);
  return tg.sendHtml(chatId, 'Ок, правка отменена.');
}

const MENU_TEXT = `<b>Канал о смыслах в моде</b>

Черновики приходят сюда сами раз в 6 часов. Под каждым — кнопки: ✅ в очередь · 🚀 сейчас · ✏️ править · ⏸ отложить · ✖️ удалить · 🖼 убрать картинку.
Чтобы поправить пост, можно просто ответить на него (свайп или «Ответить») и написать, что изменить.
Перешлите сюда любой пост из Telegram — сделаю из него черновик в формате ближайшего дня.
Пришлите скриншот из TikTok, Reels или Pinterest — разберу подпись, хэштеги и что в кадре, добавлю в тренды. Общие замечания запоминаются и учитываются в следующих черновиках — см. «Уроки редактора».
Одобренное выходит в канал в ${PUBLISH_HOURS.map((h) => `${h}:00`).join(' и ')}; если черновики ждут решения, я напомню.`;

async function menuKeyboard() {
  const { rows: [c] } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE status = 'draft')::int AS pending,
           COUNT(*) FILTER (WHERE status = 'approved')::int AS queue,
           COUNT(*) FILTER (WHERE status = 'deferred')::int AS deferred
    FROM posts`);
  const rules = (await activeRules()).length;
  return {
    inline_keyboard: [
      [{ text: `📝 Не утверждено (${c.pending})`, callback_data: 'menu:pending' }],
      [{ text: `✅ Очередь (${c.queue})`, callback_data: 'menu:queue' }, { text: `⏸ Отложенные (${c.deferred})`, callback_data: 'menu:deferred' }],
      [{ text: '📊 Статус', callback_data: 'menu:status' }, { text: '🗓 Форматы', callback_data: 'menu:formats' }],
      [{ text: `🧠 Уроки редактора (${rules})`, callback_data: 'menu:rules' }, { text: '🧹 Проверить на слоп', callback_data: 'menu:check' }],
      [{ text: '📈 Тренды', callback_data: 'menu:trends' }, { text: '▶️ Прогон сейчас', callback_data: 'menu:run' }],
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
  rules: ['Уроки редактора: что запомнено из ваших правок', cmdRules],
  check: ['Проверить очередь и черновики на ИИ-слоп', cmdCheck],
  channel: ['Какой канал вижу и с какими правами', cmdChannel],
  trends: ['Какие темы растут и угасают', cmdTrends],
  setformats: ['Определить формат у постов без формата', cmdSetFormats],
  cleanall: ['Вычистить слоп во всех найденных постах', cmdCleanAll],
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

// ─── Скриншоты соцсетей как источник трендов ────────────────────────────────

async function onScreenshot(chatId, msg) {
  const photo = msg.photo?.[msg.photo.length - 1];
  const file = photo || msg.document;
  const note = (msg.caption || '').trim();
  await tg.sendHtml(chatId, 'Разбираю скриншот…', {
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
  });

  (async () => {
    const image = await tg.downloadFile(file.file_id);
    const a = await analyzeScreenshot(image, note);
    const itemId = await saveScreenshot(a, file.file_unique_id, note);

    const stats = [a.views && `👁 ${a.views}`, a.likes && `♥ ${a.likes}`, a.comments && `💬 ${a.comments}`].filter(Boolean).join(' · ');
    const lines = [
      `<b>${tg.escapeHtml(a.platform || 'Соцсети')}</b>${a.author ? ` · ${tg.escapeHtml(a.author)}` : ''}${stats ? ` · ${stats}` : ''}`,
      a.caption && `«${tg.escapeHtml(a.caption.slice(0, 300))}»`,
      a.shows && `<i>${tg.escapeHtml(a.shows)}</i>`,
      a.hashtags.length && tg.escapeHtml(a.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')),
      a.sound && `🎵 ${tg.escapeHtml(a.sound)}`,
      '',
      a.entities.length
        ? `<b>В тренды:</b> ${a.entities.map((e) => `${tg.escapeHtml(e.display)} <i>(${KINDS[e.kind] || e.kind})</i>`).join(', ')}`
        : a.is_fashion ? 'Модных сущностей не нашлось.' : 'Похоже, ролик не про моду — в тренды не пошёл.',
    ].filter((l) => l !== false && l !== undefined && l !== '').join('\n');

    return tg.sendHtml(chatId, lines, {
      reply_markup: { inline_keyboard: [[{ text: '✍️ Сделать черновик', callback_data: `shotdraft:${itemId}` }]] },
    });
  })().catch((e) => tg.sendHtml(chatId, `Не получилось разобрать скриншот: ${tg.escapeHtml(e.message)}`).catch(() => {}));
}

// Растущие и угасающие темы за неделю
async function cmdTrends(chatId) {
  const { rising, fading, top } = await listTrends({ limit: 12 });
  if (!rising.length && !fading.length && !top.length) {
    return tg.sendHtml(chatId, 'Трендов пока мало данных: они считаются по заметкам с каждым прогоном. Загляните через пару дней или пришлите скриншоты из соцсетей.');
  }
  const arrow = (t) => (t.prev_week ? `${t.prev_week} → ${t.week}` : `новое · ${t.week}`);
  const line = (t) => `• <b>${tg.escapeHtml(t.display)}</b> <i>${KINDS[t.kind] || t.kind}</i> — ${arrow(t)} за неделю, источников ${t.feeds}${t.signals.includes('search') ? ' · 🔎 Google' : ''}${t.signals.includes('screenshot') ? ' · 📱 соцсети' : ''}`;
  const parts = [];
  if (rising.length) parts.push(`<b>📈 Растут</b>\n${rising.map(line).join('\n')}`);
  // пока истории мало, растущих нет — показываем самое упоминаемое
  else parts.push(`<b>Чаще всего за неделю</b> <i>(растущие появятся, когда накопится история)</i>\n${top.slice(0, 10).map(line).join('\n')}`);
  if (fading.length) parts.push(`<b>📉 Угасают</b>\n${fading.slice(0, 6).map(line).join('\n')}`);
  parts.push('Подробнее — на странице «Тренды» в админке.');
  return tg.sendHtml(chatId, parts.join('\n\n'));
}

// ─── Пересланные сообщения как источник ──────────────────────────────────────

// Кто автор пересланного поста и есть ли ссылка на оригинал
function forwardedOrigin(msg) {
  const o = msg.forward_origin;
  if (o?.type === 'channel') {
    return {
      source: o.chat?.title || 'Telegram-канал',
      url: o.chat?.username ? `https://t.me/${o.chat.username}/${o.message_id}` : null,
      chatId: o.chat?.id ?? null,
      username: o.chat?.username ?? null,
    };
  }
  if (o?.type === 'chat') return { source: o.sender_chat?.title || 'Telegram-чат', url: null };
  if (o?.type === 'user') {
    return { source: [o.sender_user?.first_name, o.sender_user?.last_name].filter(Boolean).join(' ') || 'Автор в Telegram', url: null };
  }
  if (o?.type === 'hidden_user') return { source: o.sender_user_name || 'Автор в Telegram', url: null };
  // старый формат Bot API
  if (msg.forward_from_chat) {
    return {
      source: msg.forward_from_chat.title || 'Telegram-канал',
      url: msg.forward_from_chat.username ? `https://t.me/${msg.forward_from_chat.username}/${msg.forward_from_message_id}` : null,
    };
  }
  return null;
}

async function onForwarded(chatId, msg) {
  const origin = forwardedOrigin(msg);
  const text = (msg.text || msg.caption || '').replace(/\s+\n/g, '\n').trim();
  if (!text) {
    return tg.sendHtml(chatId, 'В пересланном сообщении нет текста — беру в работу только текстовые посты.');
  }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines[0].slice(0, 200);
  const summary = lines.slice(1).join(' ').slice(0, 1500);
  // без ссылки на оригинал берём первую ссылку из текста, иначе — служебный адрес (в пост не попадёт)
  const url = origin?.url || text.match(/https?:\/\/\S+/)?.[0] || `forward:${msg.chat.id}:${msg.message_id}`;

  // id канала-источника пригодится для настройки TELEGRAM_CHANNEL_ID
  const idLine = origin?.chatId
    ? `\nИсточник: ${tg.escapeHtml(origin.source)} · id <code>${origin.chatId}</code>${origin.username ? ` · @${origin.username}` : ''}`
    : '';
  await tg.sendHtml(chatId, `Беру в работу: <i>${tg.escapeHtml(title.slice(0, 120))}</i>${idLine}\nЧерновик придёт через 1–2 минуты.`, {
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
  });

  draftFromSource({ title, summary, url, source: origin?.source || 'Telegram' })
    .then((r) => r.skipped && tg.sendHtml(chatId, 'Не получилось собрать пост из этого сюжета — модель не нашла в нём смысла для канала.'))
    .catch((e) => tg.sendHtml(chatId, `Не получилось: ${tg.escapeHtml(e.message)}`).catch(() => {}));
}

// ─── Обработчики ─────────────────────────────────────────────────────────────

// ─── Закрытость: бот работает только для владельца ───────────────────────────

// Посторонним не отвечаем; из групп и каналов выходим; владельцу — уведомление раз в сутки на человека
async function onStranger(msg) {
  const chat = msg.chat;
  const who = msg.from?.username ? `@${msg.from.username}` : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'без имени';
  console.log(`[bot] ignored ${chat.type} ${chat.id} (${who})`);
  if (chat.type !== 'private') {
    await tg.api('leaveChat', { chat_id: chat.id }).catch(() => {});
  }
  const seen = (await getState('strangers')) || {};
  const key = String(msg.from?.id ?? chat.id);
  if (seen[key] && Date.now() - new Date(seen[key]).getTime() < 24 * 3600e3) return;
  seen[key] = new Date().toISOString();
  await setState('strangers', seen);
  const where = chat.type === 'private' ? 'написал(а) боту' : `добавил(а) бота в «${tg.escapeHtml(chat.title || chat.type)}» — бот вышел оттуда`;
  await tg.sendHtml(tg.OWNER, `🔒 Посторонний ${tg.escapeHtml(who)} ${where}. Посторонним бот не отвечает.`).catch(() => {});
}

// Бота добавили в группу или канал — выходим, если это сделал не владелец
async function onMembership(u) {
  const { chat, from, new_chat_member: member } = u;
  if (chat.type === 'private' || String(from?.id) === String(tg.OWNER)) return;
  if (!['member', 'administrator'].includes(member?.status)) return;
  await onStranger({ chat, from });
}

async function onCallback(q) {
  await tg.api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  if (String(q.from?.id) !== String(tg.OWNER)) return;

  const [action, arg] = q.data.split(':');
  if (action === 'noop') return;
  if (action === 'menu') return COMMANDS[arg]?.[1](tg.OWNER);
  if (action === 'clean') {
    // чистка идёт минуту — не держим бота
    cleanOne(tg.OWNER, Number(arg)).catch((e) => tg.sendHtml(tg.OWNER, `Ошибка: ${tg.escapeHtml(e.message)}`).catch(() => {}));
    return;
  }
  if (action === 'shotdraft') {
    await tg.sendHtml(tg.OWNER, 'Делаю черновик из скриншота — придёт через 1–2 минуты.');
    draftFromItem(Number(arg))
      .then((r) => r.skipped && tg.sendHtml(tg.OWNER, 'Модель не нашла в этом ролике смысла для поста.'))
      .catch((e) => tg.sendHtml(tg.OWNER, `Не получилось: ${tg.escapeHtml(e.message)}`).catch(() => {}));
    return;
  }
  if (action === 'delrule') {
    const removed = await removeRule(Number(arg));
    return tg.sendHtml(tg.OWNER, removed ? 'Правило убрано.' : 'Это правило уже убрано или объединено с другими — см. /rules.');
  }
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
    case 'approve': return actions.approve(postId);
    case 'now': return actions.publishNow(postId);
    case 'defer': return actions.defer(postId);
    case 'reject': return actions.reject(postId);
    case 'noimg': return actions.removeImage(postId);
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

  if (!tg.OWNER) {
    // Режим настройки: владелец ещё не задан — на /start отвечаем chat id, чтобы его узнать
    if (text.startsWith('/start')) {
      await tg.api('sendMessage', {
        chat_id: chatId,
        text: `Ваш chat id: ${chatId}\nВпишите его в TELEGRAM_OWNER_CHAT_ID и перезапустите сервис.`,
      });
    }
    return;
  }
  if (chatId !== String(tg.OWNER)) return onStranger(msg);

  // Скриншот из соцсети (фото или картинка файлом) — источник для трендов
  if (msg.photo?.length || msg.document?.mime_type?.startsWith('image/')) return onScreenshot(chatId, msg);

  // Пересланный пост из Telegram — это источник для нового черновика
  if (msg.forward_origin || msg.forward_from_chat || msg.forward_sender_name) return onForwarded(chatId, msg);

  const command = text.match(/^\/(\w+)/)?.[1];
  if (command === 'rule') {
    const rule = text.replace(/^\/rule(@\w+)?\s*/, '').trim();
    if (!rule) return tg.sendHtml(chatId, 'Напишите правило после команды: /rule Не начинай пост с цифры');
    await addRule(rule);
    return tg.sendHtml(chatId, `🧠 Добавлено: <i>${tg.escapeHtml(rule)}</i>`);
  }
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
        offset, timeout: 30, allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        await setState('tg_offset', offset);
        try {
          if (u.callback_query) await onCallback(u.callback_query);
          else if (u.message) await onMessage(u.message);
          else if (u.my_chat_member && tg.OWNER) await onMembership(u.my_chat_member);
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

module.exports = { poll, setupMenu, __test: { onMessage, onCallback, onMembership } };

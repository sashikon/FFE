require('dotenv').config();
const { pool, runMigrations, getState, setState } = require('./db');
const { runPipeline } = require('./pipeline');
const { publish, sendHtml, escapeHtml, resendUndelivered, checkTelegram, checkChannel, OWNER } = require('./telegram');
const { poll, setupMenu } = require('./bot');
const { startApi } = require('./api');

const HOUR = 3600 * 1000;
const INTERVAL_HOURS = Number(process.env.PIPELINE_INTERVAL_HOURS || 6);
const { PUBLISH_HOURS, TZ, localParts, formatToday } = require('./formats');

// Раз в 5 минут: если сейчас слот публикации и в этот слот ещё ничего не выходило —
// публикуем одобренный пост формата дня, а если такого нет — старейший одобренный
async function publishDue() {
  if (!PUBLISH_HOURS.includes(localParts(new Date()).hour)) return;
  const { rows: recent } = await pool.query(
    `SELECT 1 FROM posts WHERE published_at > NOW() - INTERVAL '90 minutes' LIMIT 1`
  );
  if (recent.length) return;
  const { rows: [next] } = await pool.query(
    `SELECT id FROM posts WHERE status = 'approved'
     ORDER BY (format = $1) DESC NULLS LAST, approved_at LIMIT 1`,
    [formatToday().key]
  );
  if (!next) return;
  try {
    await publish(next.id);
    console.log(`[publish] post ${next.id}`);
  } catch (e) {
    console.error('[publish] failed', e);
    const channel = await checkChannel().catch(() => ({ ok: true }));
    const hint = channel.ok ? '' : `\n\nПричина: ${escapeHtml(channel.problem)}`;
    await sendHtml(OWNER, `Не удалось опубликовать #${next.id}: ${escapeHtml(e.message)}${hint}\nПост остался в очереди.`).catch(() => {});
  }
}

// Прогон не чаще интервала — даже если сервис перезапускался (деплой, падение)
async function pipelineIfDue() {
  const problem = await checkTelegram();
  if (problem) {
    console.error(`[pipeline] пропущен: ${problem}`);
    return;
  }
  const resent = await resendUndelivered();
  if (resent) console.log(`[pipeline] дослано черновиков: ${resent}`);

  const last = await getState('last_pipeline_at');
  if (last && Date.now() - new Date(last).getTime() < INTERVAL_HOURS * HOUR * 0.95) return;
  await setState('last_pipeline_at', new Date().toISOString());
  await runPipeline();
}

// Напоминания о черновиках без решения: раз в REMIND_EVERY_HOURS, срочно — за час до слота при пустой очереди.
// Ночью (QUIET_HOURS, по умолчанию 22–9) бот молчит; отложенные (⏸) не считаются
const REMIND_EVERY_HOURS = Number(process.env.REMIND_EVERY_HOURS || 4);
const [QUIET_FROM, QUIET_TO] = (process.env.QUIET_HOURS || '22-9').split('-').map(Number);

async function remindIfDue() {
  const { hour } = localParts(new Date());
  if (hour >= QUIET_FROM || hour < QUIET_TO) return;

  const { rows: pending } = await pool.query(
    `SELECT id, review_message_id FROM posts
     WHERE status = 'draft' AND review_message_id IS NOT NULL AND created_at < NOW() - INTERVAL '2 hours'
     ORDER BY created_at`
  );
  if (!pending.length) return;

  const { rows: [queue] } = await pool.query(`SELECT COUNT(*)::int AS n FROM posts WHERE status = 'approved'`);
  const urgent = PUBLISH_HOURS.includes(hour + 1) && queue.n === 0;

  const last = await getState('last_reminder_at');
  const gapHours = urgent ? 1 : REMIND_EVERY_HOURS;
  if (last && Date.now() - new Date(last).getTime() < gapHours * HOUR) return;
  await setState('last_reminder_at', new Date().toISOString());

  const n = pending.length;
  const n10 = n % 10;
  const n100 = n % 100;
  const word = n10 === 1 && n100 !== 11 ? 'черновик'
    : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'черновика' : 'черновиков';
  const drafts = `${n} ${word}`;
  const text = urgent
    ? `⏰ Через час публикация в канал, а в очереди пусто. Не утверждено: ${drafts} — /pending.`
    : `🔔 Не утверждено: ${drafts}. Самый старый — выше, весь список — /pending.`;
  await sendHtml(OWNER, text, {
    reply_parameters: { message_id: Number(pending[0].review_message_id), allow_sending_without_reply: true },
  });
  console.log(`[remind] ${n} pending${urgent ? ' (urgent)' : ''}`);
}

function safely(name, fn) {
  return () => fn().catch((e) => console.error(`[${name}]`, e));
}

async function start() {
  for (const key of ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHANNEL_ID']) {
    if (!process.env[key]) throw new Error(`${key} is not set`);
  }
  const dbHost = new URL(process.env.DATABASE_URL).host;
  console.log(`[start] connecting to database ${dbHost}`);
  await runMigrations();
  console.log('[start] database ok, checking Telegram');

  const problem = await checkTelegram();
  if (problem) console.error(`[telegram] ${problem}`);
  else console.log(`[telegram] ok, owner ${OWNER}`);

  // прогон, оборванный деплоем или падением, иначе исчезает молча — а человек ждёт ответа
  const interrupted = await getState('run_started').catch(() => null);
  if (interrupted) {
    await setState('run_started', null).catch(() => {});
    console.warn(`[pipeline] прошлый прогон оборван на перезапуске (начался ${interrupted})`);
  }

  startApi();
  poll();
  if (!OWNER) return;
  await setupMenu().catch((e) => console.error('[telegram] menu setup failed', e.message));
  const channel = await checkChannel().catch((e) => ({ ok: false, problem: e.message }));
  if (interrupted) {
    const at = new Date(interrupted).toLocaleString('ru-RU', { timeZone: process.env.TZ || 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
    await sendHtml(OWNER, `⚠️ Прогон, начатый в ${at}, оборвался: сервис перезапустился (обычно это деплой). Черновики, которые успели уйти, остались. Можно запустить заново — /run.`).catch(() => {});
  }
  if (channel.ok) console.log(`[telegram] channel ok: ${channel.title}`);
  else {
    console.error(`[telegram] channel problem: ${channel.problem}`);
    await sendHtml(OWNER, `⚠️ Публиковать в канал сейчас не получится: ${escapeHtml(channel.problem)}\n\nПосле исправления переменных в Railway нажмите Deploy.`).catch(() => {});
  }

  setInterval(safely('publish', publishDue), 5 * 60 * 1000);
  setInterval(safely('remind', remindIfDue), 10 * 60 * 1000);
  setInterval(safely('pipeline', pipelineIfDue), 10 * 60 * 1000);
  safely('pipeline', pipelineIfDue)();
  console.log(`channel bot started: pipeline every ${INTERVAL_HOURS}h, publish at ${PUBLISH_HOURS.join(', ')} (${TZ})`);
}

if (require.main === module) start().catch((err) => { console.error(err); process.exit(1); });

module.exports = { remindIfDue };

require('dotenv').config();
const { pool, runMigrations, getState, setState } = require('./db');
const { runPipeline } = require('./pipeline');
const { publish, sendHtml, escapeHtml, resendUndelivered, checkTelegram, OWNER } = require('./telegram');
const { poll } = require('./bot');

const HOUR = 3600 * 1000;
const INTERVAL_HOURS = Number(process.env.PIPELINE_INTERVAL_HOURS || 6);
const PUBLISH_HOURS = (process.env.PUBLISH_HOURS || '10,19').split(',').map(Number);
const TZ = process.env.TZ || 'Europe/Moscow';

function currentHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(new Date()));
}

// Раз в 5 минут: если сейчас слот публикации и в этот слот ещё ничего не выходило — публикуем старейший одобренный
async function publishDue() {
  if (!PUBLISH_HOURS.includes(currentHour())) return;
  const { rows: recent } = await pool.query(
    `SELECT 1 FROM posts WHERE published_at > NOW() - INTERVAL '90 minutes' LIMIT 1`
  );
  if (recent.length) return;
  const { rows: [next] } = await pool.query(
    `SELECT id FROM posts WHERE status = 'approved' ORDER BY approved_at LIMIT 1`
  );
  if (!next) return;
  try {
    await publish(next.id);
    console.log(`[publish] post ${next.id}`);
  } catch (e) {
    console.error('[publish] failed', e);
    await sendHtml(OWNER, `Не удалось опубликовать #${next.id}: ${escapeHtml(e.message)}`).catch(() => {});
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

  poll();
  if (!OWNER) return;

  setInterval(safely('publish', publishDue), 5 * 60 * 1000);
  setInterval(safely('pipeline', pipelineIfDue), 10 * 60 * 1000);
  safely('pipeline', pipelineIfDue)();
  console.log(`channel bot started: pipeline every ${INTERVAL_HOURS}h, publish at ${PUBLISH_HOURS.join(', ')} (${TZ})`);
}

start().catch((err) => { console.error(err); process.exit(1); });

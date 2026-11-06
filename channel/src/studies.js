const { pool } = require('./db');
const { call, MODELS } = require('./llm');
const P = require('./prompts');
const { FORMATS, formatByKey } = require('./formats');

// Исследования автора как источник постов. Хранение и планирование живут здесь,
// сам черновик пишет pipeline.js — той же дорогой, что и пост из новостной ленты

// Меньше этого на пост не хватает: план, список литературы, обрывок без вывода
const MIN_CHARS = 500;
// Планировщику отдаём текст целиком, но не больше: дальше он перестаёт помещаться
// в окно модели. Это предел чтения, а не предел загрузки — хранится текст целиком
const PLAN_LIMIT = 400_000;

// Название из текста: первая строка, а если автор вставила текст без переносов —
// первое предложение. Режем по границе слова, чтобы в списке не висел обрубок
function titleFromText(text) {
  const first = (text.trim().split('\n').find((l) => l.trim().length > 3) || 'Исследование')
    .trim().replace(/^#+\s*/, '');
  const sentence = first.split(/(?<=[.!?])\s/)[0];
  const head = sentence.length > 10 ? sentence : first;
  if (head.length <= 90) return head;
  const cut = head.slice(0, 90);
  return `${cut.slice(0, cut.lastIndexOf(' ')) || cut}…`;
}

async function saveStudy({ title, text, note = null }) {
  const body = String(text || '').trim();
  if (body.length < MIN_CHARS) {
    const e = new Error(`В тексте ${body.length} знаков — на пост этого мало, нужно хотя бы ${MIN_CHARS}`);
    e.badRequest = true;
    throw e;
  }
  const { rows: [study] } = await pool.query(
    `INSERT INTO studies (title, text, note) VALUES ($1, $2, $3) RETURNING id, title, text, note, status, created_at`,
    [String(title || '').trim() || titleFromText(body), body, String(note || '').trim() || null]
  );
  return study;
}

// ─── Загрузка частями ────────────────────────────────────────────────────────
// Между браузером и сервисом канала стоит Vercel, который не пропускает запрос
// больше 4,5 МБ. Поэтому длинный текст идёт частями: сначала заводим исследование,
// потом дописываем к нему куски, в конце проверяем длину и пускаем в работу.
// Так предела на размер исследования нет вовсе

async function startUpload({ title, note }) {
  const { rows: [study] } = await pool.query(
    `INSERT INTO studies (title, text, note, status) VALUES ($1, '', $2, 'uploading') RETURNING id`,
    [String(title || '').trim() || 'Без названия', String(note || '').trim() || null]
  );
  return study;
}

async function appendText(id, part) {
  const { rows: [row] } = await pool.query(
    `UPDATE studies SET text = text || $1 WHERE id = $2 AND status = 'uploading'
     RETURNING LENGTH(text) AS chars`,
    [String(part || ''), id]
  );
  if (!row) {
    const e = new Error('Загрузка этого исследования уже закрыта — начните заново');
    e.badRequest = true;
    throw e;
  }
  return Number(row.chars);
}

// Название из первой строки ставим здесь: при загрузке частями текста ещё нет
async function finishUpload(id) {
  const study = await getStudy(id);
  if (!study) {
    const e = new Error('Исследование не найдено');
    e.badRequest = true;
    throw e;
  }
  const body = study.text.trim();
  if (body.length < MIN_CHARS) {
    await pool.query('DELETE FROM studies WHERE id = $1', [id]);
    const e = new Error(`В тексте ${body.length} знаков — на пост этого мало, нужно хотя бы ${MIN_CHARS}`);
    e.badRequest = true;
    throw e;
  }
  const title = study.title === 'Без названия' ? titleFromText(body) : study.title;
  await pool.query(`UPDATE studies SET text = $1, title = $2, status = 'new' WHERE id = $3`, [body, title, id]);
  return { id, title, chars: body.length };
}

async function getStudy(id) {
  const { rows: [study] } = await pool.query('SELECT * FROM studies WHERE id = $1', [id]);
  return study || null;
}

// Сколько постов выйдет из текста и на чём каждый будет стоять
async function planStudy(study) {
  const plan = await call({
    model: MODELS.smart,
    system: P.studyPlanSystem(FORMATS),
    user: P.studyPlanUser(study, PLAN_LIMIT),
    schema: P.STUDY_PLAN_SCHEMA,
    maxTokens: 12000,
  });
  // предел числа постов держим и в коде: схема — просьба к модели, а не гарантия
  const posts = (plan.posts || []).slice(0, 2).map((p) => ({
    ...p,
    format: formatByKey(p.format) ? p.format : null,
  }));
  if (!posts.length) throw new Error('планировщик не нашёл в тексте ни одного сюжета');
  const saved = { why: plan.why, posts };
  await pool.query(`UPDATE studies SET plan = $1, status = 'planned', error_msg = NULL WHERE id = $2`, [saved, study.id]);
  console.log(`[studies] #${study.id} «${study.title}»: постов ${posts.length} — ${plan.why}`);
  return saved;
}

// Список для админки: что загружено, что из этого вышло и где это посмотреть
async function listStudies() {
  const { rows } = await pool.query(`
    SELECT s.id, s.title, s.note, s.status, s.plan, s.error_msg, s.created_at,
           LENGTH(s.text) AS chars,
           COALESCE(
             JSON_AGG(JSON_BUILD_OBJECT('id', p.id, 'status', p.status, 'format', p.format, 'text', LEFT(p.text, 200))
                      ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL),
             '[]'
           ) AS posts
    FROM studies s
    LEFT JOIN clusters c ON c.study_id = s.id
    LEFT JOIN insights i ON i.cluster_id = c.id
    LEFT JOIN posts p ON p.insight_id = i.id
    GROUP BY s.id
    ORDER BY s.id DESC
    LIMIT 100`);
  return {
    studies: rows.map((s) => ({
      ...s,
      chars: Number(s.chars),
      posts: s.posts.map((p) => ({ ...p, format_title: formatByKey(p.format)?.title ?? null })),
    })),
    min_chars: MIN_CHARS,
  };
}

// Повтор разбора: сразу помечаем, что работа пошла. Иначе карточка минуту
// висит с прежней ошибкой, и кнопка выглядит так, будто не сработала
async function markWorking(id) {
  await pool.query(`UPDATE studies SET status = 'new', error_msg = NULL WHERE id = $1`, [id]);
}

async function failStudy(id, message) {
  await pool.query(`UPDATE studies SET status = 'failed', error_msg = $1 WHERE id = $2`, [message, id]);
}

module.exports = {
  saveStudy, getStudy, planStudy, listStudies, failStudy,
  startUpload, appendText, finishUpload, markWorking,
  MIN_CHARS, PLAN_LIMIT,
};

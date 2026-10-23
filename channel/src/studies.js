const { pool } = require('./db');
const { call, MODELS } = require('./llm');
const P = require('./prompts');
const { FORMATS, formatByKey } = require('./formats');

// Исследования автора как источник постов. Хранение и планирование живут здесь,
// сам черновик пишет pipeline.js — той же дорогой, что и пост из новостной ленты

// Меньше этого на пост не хватает: план, список литературы, обрывок без вывода
const MIN_CHARS = 500;
// Планировщику отдаём текст целиком, но не больше: дальше это уже не работа с текстом
const PLAN_LIMIT = 120_000;

function titleFromText(text) {
  const first = text.trim().split('\n').find((l) => l.trim().length > 3) || 'Исследование';
  return first.trim().replace(/^#+\s*/, '').slice(0, 120);
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

async function failStudy(id, message) {
  await pool.query(`UPDATE studies SET status = 'failed', error_msg = $1 WHERE id = $2`, [message, id]);
}

module.exports = { saveStudy, getStudy, planStudy, listStudies, failStudy, MIN_CHARS, PLAN_LIMIT };

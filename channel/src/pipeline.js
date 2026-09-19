const { pool } = require('./db');
const { collectAll } = require('./collect');
const { clusterNewItems, clusterItems } = require('./cluster');
const { call, MODELS } = require('./llm');
const P = require('./prompts');
const { formatForNextSlot, formatByKey, FORMATS } = require('./formats');
const { refreshLibrary, pickImage } = require('./library');
const { activeRules } = require('./learn');
const { cleanInvisible, findSlop, describeSlop } = require('./slop');
const { sendReview, escapeHtml, TelegramError } = require('./telegram');

const MIN_SCORE = Number(process.env.MIN_SCORE || 4);
const DRAFTS_PER_RUN = Number(process.env.DRAFTS_PER_RUN || 3);
const SCORE_BATCH = 25;

// ─── Шаг 3: отбор ────────────────────────────────────────────────────────────

async function scoreNew() {
  const { rows } = await pool.query(`SELECT id FROM clusters WHERE status = 'new' ORDER BY id`);
  for (let i = 0; i < rows.length; i += SCORE_BATCH) {
    const batch = await Promise.all(
      rows.slice(i, i + SCORE_BATCH).map(async ({ id }) => ({ id, items: await clusterItems(id) }))
    );
    const { results } = await call({
      model: MODELS.cheap,
      system: P.SCORE_SYSTEM,
      user: P.scoreUser(batch),
      schema: P.SCORE_SCHEMA,
      maxTokens: 8000,
    });
    const ids = new Set(batch.map((c) => c.id));
    for (const r of results) {
      if (!ids.has(r.cluster_id)) continue;
      await pool.query(
        `UPDATE clusters SET status = 'scored', score = $1, lens = $2, score_reason = $3 WHERE id = $4`,
        [r.score, r.lens, r.reason, r.cluster_id]
      );
    }
  }
  console.log(`[score] scored ${rows.length} clusters`);
}

// Лучшие сюжеты; линзы трёх последних постов слегка штрафуем, чтобы канал не зацикливался
async function selectCandidates(limit) {
  const { rows: recent } = await pool.query(
    `SELECT i.lens FROM posts p JOIN insights i ON i.id = p.insight_id
     WHERE p.status IN ('approved', 'published') ORDER BY p.created_at DESC LIMIT 3`
  );
  const recentLenses = new Set(recent.map((r) => r.lens));

  const { rows } = await pool.query(
    `SELECT c.id, c.score, c.lens, COUNT(i.id)::int AS n_items,
            BOOL_OR(i.layer = 'production') AS has_production
     FROM clusters c JOIN items i ON i.cluster_id = c.id
     WHERE c.status = 'scored' AND c.score >= $1 AND c.created_at > NOW() - INTERVAL '72 hours'
     GROUP BY c.id`,
    [MIN_SCORE]
  );
  const rank = (c) =>
    c.score + Math.min(c.n_items - 1, 3) * 0.3 + (c.has_production ? 0.3 : 0) - (recentLenses.has(c.lens) ? 0.7 : 0);
  return rows.sort((a, b) => rank(b) - rank(a)).slice(0, limit);
}

// ─── Шаг 4: смысл ────────────────────────────────────────────────────────────

async function makeInsight(clusterId, format) {
  const items = await clusterItems(clusterId);
  const { rows: memory } = await pool.query(
    `SELECT thesis FROM insights ORDER BY created_at DESC LIMIT 40`
  );
  const insight = await call({
    model: MODELS.smart,
    system: P.INSIGHT_SYSTEM,
    user: P.insightUser(items, memory.map((m) => m.thesis), format),
    schema: P.INSIGHT_SCHEMA,
  });

  if (insight.weak || insight.is_repeat) {
    const why = insight.weak ? 'weak' : 'repeat';
    await pool.query(
      `UPDATE clusters SET status = 'rejected', score_reason = COALESCE(score_reason, '') || ' | insight: ' || $1 WHERE id = $2`,
      [why, clusterId]
    );
    console.log(`[insight] cluster ${clusterId} rejected (${why})`);
    return null;
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO insights (cluster_id, data, thesis, lens, format) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [clusterId, JSON.stringify(insight), insight.thesis, insight.lens, format.key]
  );
  await pool.query(`UPDATE clusters SET status = 'insight' WHERE id = $1`, [clusterId]);
  return row.id;
}

// ─── Шаг 5: текст ────────────────────────────────────────────────────────────

function sourcesFooter(items) {
  const seen = new Set();
  const links = [];
  for (const it of items) {
    // «The Guardian» и «The Guardian Fashion» — одно издание
    const base = it.source.toLowerCase().replace(/\s+(fashion|style|news)$/, '');
    if (seen.has(base) || it.source.startsWith('GN:')) continue;
    seen.add(base);
    links.push(`<a href="${escapeHtml(it.url)}">${escapeHtml(it.source)}</a>`);
    if (links.length === 3) break;
  }
  return `\n\n<i>По материалам: ${links.join(', ')}</i>`;
}

async function draftPost(insightId, previous = null) {
  const { rows: [ins] } = await pool.query('SELECT cluster_id, data, format FROM insights WHERE id = $1', [insightId]);
  const format = formatByKey(ins.format) || FORMATS[0];
  const rules = await activeRules();
  const draft = await call({
    model: MODELS.smart,
    system: P.writeSystem(format, rules),
    user: P.writeUser(ins.data, previous),
    cache: true,
  });
  // Отдельный проход литредактора: грамматика, пунктуация, кальки, приметы машинного текста
  let text = cleanInvisible(await call({ model: MODELS.smart, system: P.editSystem(rules), user: draft }));
  // Детектор слопа: если после литредактора остались шаблоны — точечная правка именно этих мест
  const hits = findSlop(text);
  if (hits.length) {
    console.log(`[slop] ${hits.length} hit(s), fixing`);
    text = cleanInvisible(await call({
      model: MODELS.smart,
      system: P.editSystem(rules),
      user: `${P.slopFixInstruction(describeSlop(hits))}\n\n${text}`,
    }));
  }
  const items = await clusterItems(ins.cluster_id);
  // Картинка из игры — только если подходит по смыслу; ошибка подбора не мешает посту
  const image = await pickImage(text, ins.data.thesis).catch((e) => {
    console.warn(`[library] pick failed: ${e.message}`);
    return null;
  });
  const { rows: [post] } = await pool.query(
    `INSERT INTO posts (insight_id, text, format, image_url, image_ref) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [insightId, text + sourcesFooter(items), format.key, image?.url ?? null, image?.ref ?? null]
  );
  await pool.query(`UPDATE clusters SET status = 'drafted' WHERE id = $1`, [ins.cluster_id]);
  await sendReview(post.id);
  return post.id;
}

// Правка по комментарию: новая версия заменяет старую
async function redraft(postId, feedback) {
  const { rows: [old] } = await pool.query('SELECT insight_id, text FROM posts WHERE id = $1', [postId]);
  // из прошлой версии убираем автоматическую подпись с источниками
  const previousText = old.text.replace(/\n\n<i>По материалам:[\s\S]*$/, '');
  const newId = await draftPost(old.insight_id, { text: previousText, feedback });
  await pool.query(`UPDATE posts SET status = 'superseded', feedback = $1 WHERE id = $2`, [feedback, postId]);
  return newId;
}

// Вычистить слоп в уже готовом посте: точечная правка найденных мест, без переписывания поста.
// Новая версия приходит на утверждение, старая (в т. ч. из очереди) помечается superseded
async function cleanSlop(postId) {
  const { rows: [old] } = await pool.query(
    'SELECT insight_id, text, format, image_url, image_ref FROM posts WHERE id = $1', [postId]
  );
  const cut = old.text.indexOf('\n\n<i>По материалам:');
  const body = cut === -1 ? old.text : old.text.slice(0, cut);
  const footer = cut === -1 ? '' : old.text.slice(cut);
  const hits = findSlop(body);
  if (!hits.length) return null;

  const rules = await activeRules();
  const fixed = cleanInvisible(await call({
    model: MODELS.smart,
    system: P.editSystem(rules),
    user: `${P.slopFixInstruction(describeSlop(hits))}\n\n${body}`,
  }));
  const { rows: [post] } = await pool.query(
    `INSERT INTO posts (insight_id, text, format, image_url, image_ref) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [old.insight_id, fixed + footer, old.format, old.image_url, old.image_ref]
  );
  await pool.query(`UPDATE posts SET status = 'superseded', feedback = '[чистка слопа]' WHERE id = $1`, [postId]);
  await sendReview(post.id);
  return { newId: post.id, fixed: hits.length, left: findSlop(fixed).length };
}

// ─── Прогон целиком ──────────────────────────────────────────────────────────

let running = false;

async function runPipeline() {
  if (running) return { skipped: true };
  running = true;
  try {
    await collectAll();
    await refreshLibrary().catch((e) => console.warn(`[library] refresh failed: ${e.message}`));
    await clusterNewItems();
    await scoreNew();

    const format = formatForNextSlot();
    console.log(`[pipeline] format: ${format.title}`);
    // Под конкретный формат подходит не каждый сюжет — берём кандидатов с запасом
    const candidates = await selectCandidates(DRAFTS_PER_RUN * 3);
    let drafted = 0;
    for (const c of candidates) {
      if (drafted >= DRAFTS_PER_RUN) break;
      try {
        const insightId = await makeInsight(c.id, format);
        if (!insightId) continue;
        await draftPost(insightId);
        drafted++;
      } catch (e) {
        // Черновик уже сохранён — его дошлёт resendUndelivered; дальше не тратим модель впустую
        if (e instanceof TelegramError) {
          console.error(`[pipeline] Telegram недоступен, прогон остановлен: ${e.message}`);
          break;
        }
        console.error(`[pipeline] cluster ${c.id} failed`, e);
        await pool.query(`UPDATE clusters SET status = 'failed', error_msg = $1 WHERE id = $2`, [e.message, c.id]);
      }
    }
    console.log(`[pipeline] drafts sent: ${drafted}`);
    return { drafted, candidates: candidates.length, format: format.title };
  } finally {
    running = false;
  }
}

module.exports = { runPipeline, redraft, cleanSlop, scoreNew, __draftPost: draftPost };

const { pool, setState } = require('./db');
const { collectAll } = require('./collect');
const { clusterNewItems, clusterItems } = require('./cluster');
const { call, MODELS } = require('./llm');
const P = require('./prompts');
const { formatForNextSlot, formatByKey, FORMATS } = require('./formats');
const { refreshLibrary, pickImage } = require('./library');
const { activeRules } = require('./learn');
const { withBrandLogo } = require('./brand');
const { runTrends } = require('./trends');
const { researchOrigin } = require('./research');
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

// force — сюжет прислан автором вручную: слабый или повторяющийся разбор не отбрасываем
async function makeInsight(clusterId, format, force = false) {
  const items = await clusterItems(clusterId);
  const { rows: memory } = await pool.query(
    `SELECT thesis FROM insights ORDER BY created_at DESC LIMIT 40`
  );
  // истоки вещи ищем в вебе: своей памяти модели на даты и имена доверять нельзя
  const research = await researchOrigin(items).catch((e) => {
    console.warn(`[research] справка не собралась: ${e.message}`);
    return null;
  });
  const insight = await call({
    model: MODELS.smart,
    system: P.INSIGHT_SYSTEM,
    user: P.insightUser(items, memory.map((m) => m.thesis), format, research),
    schema: P.INSIGHT_SCHEMA,
  });

  if ((insight.weak || insight.is_repeat) && !force) {
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
    [clusterId, JSON.stringify({ ...insight, research: research || undefined }), insight.thesis, insight.lens, format.key]
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
    if (seen.has(base) || it.source.startsWith('GN:') || !it.url.startsWith('http')) continue;
    seen.add(base);
    links.push(`<a href="${escapeHtml(it.url)}">${escapeHtml(it.source)}</a>`);
    if (links.length === 3) break;
  }
  return links.length ? `\n\n<i>По материалам: ${links.join(', ')}</i>` : '';
}

// Чем начинались и кончались последние посты: повтор приёма заметнее повтора темы
async function recentShapes(limit = 5) {
  const { rows } = await pool.query(
    `SELECT text FROM posts ORDER BY id DESC LIMIT $1`, [limit]
  );
  return rows.map((r) => {
    const lines = r.text
      .replace(/\n\n<i>По материалам:[\s\S]*$/, '')
      .replace(/<[^>]+>/g, '')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    return {
      opening: (lines[0] || '').slice(0, 90),
      ending: (lines[lines.length - 1] || '').slice(0, 90),
    };
  }).filter((r) => r.opening);
}

async function draftPost(insightId, previous = null) {
  const { rows: [ins] } = await pool.query('SELECT cluster_id, data, format FROM insights WHERE id = $1', [insightId]);
  const format = formatByKey(ins.format) || FORMATS[0];
  const rules = await activeRules();
  const recent = await recentShapes().catch(() => []);
  const draft = await call({
    model: MODELS.smart,
    system: P.writeSystem(format, rules),
    user: P.writeUser(ins.data, previous, recent),
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
  const imageUrl = image ? await withBrandLogo(image.url) : null;
  const { rows: [post] } = await pool.query(
    `INSERT INTO posts (insight_id, text, format, image_url, image_ref) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [insightId, text + sourcesFooter(items), format.key, imageUrl, image?.ref ?? null]
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

// Сюжет, присланный автором вручную (пересланный пост из Telegram): сразу в разбор и в черновик
async function draftFromSource({ title, summary, url, source, layer = 'culture' }) {
  const { rows: [cluster] } = await pool.query(
    `INSERT INTO clusters (status, score, lens, score_reason) VALUES ('scored', 5, 'sign', 'прислано вручную') RETURNING id`
  );
  await pool.query(
    `INSERT INTO items (source, feed, layer, url, title, summary, published_at, cluster_id)
     VALUES ($1, 'Переслано вручную', $2, $3, $4, $5, NOW(), $6)
     ON CONFLICT (url) DO UPDATE SET cluster_id = EXCLUDED.cluster_id`,
    [source, layer, url, title, summary || null, cluster.id]
  );

  const format = formatForNextSlot();
  const insight = await makeInsight(cluster.id, format, true);
  if (!insight) return { skipped: true, format: format.title };
  const postId = await draftPost(insight);
  return { postId, format: format.title };
}

// Черновик из уже сохранённой заметки (например, разобранного скриншота соцсети)
// Пост из темы трендов: берём заметки, в которых тема всплывала, и делаем из них
// один сюжет — так пишется текст не про одну новость, а про то, что за ними общего
const TREND_ITEMS = 8;

// Формат под материал: у ручного черновика нет причин брать формат сегодняшнего дня
async function pickFormat(items) {
  const notes = items.map((it, i) => `[${i + 1}] ${it.source}\n${it.title}${it.summary ? `\n${it.summary.slice(0, 300)}` : ''}`).join('\n\n');
  const res = await call({
    model: MODELS.cheap,
    system: P.formatPickSystem(FORMATS),
    user: notes,
    schema: {
      type: 'object',
      properties: { format: { type: 'string', enum: FORMATS.map((f) => f.key) }, reason: { type: 'string' } },
      required: ['format', 'reason'],
      additionalProperties: false,
    },
  });
  const format = formatByKey(res.format);
  if (format) console.log(`[pipeline] формат по материалу: «${format.title}» — ${res.reason}`);
  return format || formatForNextSlot();
}

async function draftFromTrend(termId, { format: formatKey = null } = {}) {
  const { rows: [term] } = await pool.query('SELECT display FROM trend_terms WHERE id = $1', [termId]);
  if (!term) return { skipped: 'темы нет' };

  const { rows } = await pool.query(
    `SELECT item_id FROM (
       SELECT item_id, MAX(seen_at) AS seen FROM trend_mentions
       WHERE term_id = $1 AND item_id IS NOT NULL GROUP BY item_id
     ) s ORDER BY seen DESC LIMIT $2`,
    [termId, TREND_ITEMS]
  );
  const ids = rows.map((r) => r.item_id);
  // тема может держаться только на поиске и соцсетях — писать тогда не из чего
  if (!ids.length) return { skipped: 'у темы нет заметок из ленты' };

  const { rows: [cluster] } = await pool.query(
    `INSERT INTO clusters (status, score, lens, score_reason) VALUES ('scored', 5, 'sign', $1) RETURNING id`,
    [`тема «${term.display}» из трендов`]
  );
  await pool.query('UPDATE items SET cluster_id = $1 WHERE id = ANY($2)', [cluster.id, ids]);

  const chosen = formatKey && formatKey !== 'auto' ? formatByKey(formatKey) : null;
  const format = chosen || await pickFormat(await clusterItems(cluster.id));
  const insight = await makeInsight(cluster.id, format, true);
  if (!insight) return { skipped: true, format: format.title };
  return { postId: await draftPost(insight), format: format.title, items: ids.length };
}

// Сколько заметок ленты стоит за темой — чтобы кнопка могла сказать это до запуска
async function trendItemCount(termId) {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(DISTINCT item_id)::int AS n FROM trend_mentions WHERE term_id = $1 AND item_id IS NOT NULL`,
    [termId]
  );
  return r.n;
}

async function draftFromItem(itemId) {
  const { rows: [cluster] } = await pool.query(
    `INSERT INTO clusters (status, score, lens, score_reason) VALUES ('scored', 5, 'sign', 'прислано вручную') RETURNING id`
  );
  await pool.query('UPDATE items SET cluster_id = $1 WHERE id = $2', [cluster.id, itemId]);
  const format = formatForNextSlot();
  const insight = await makeInsight(cluster.id, format, true);
  if (!insight) return { skipped: true, format: format.title };
  return { postId: await draftPost(insight), format: format.title };
}

// ─── Прогон целиком ──────────────────────────────────────────────────────────

let running = false;

const TIMEOUT_MIN = Number(process.env.PIPELINE_TIMEOUT_MIN || 40);

const timeoutIn = (minutes) => new Promise((_, reject) => {
  setTimeout(() => reject(new Error(`прогон идёт дольше ${minutes} минут — похоже, он застрял`)), minutes * 60_000).unref();
});

// onStage — сообщить, на каком шаге прогон: он идёт минутами, и со стороны
// неотличим живой прогон от упавшего
async function runPipeline({ onStage = () => {} } = {}) {
  if (running) return { skipped: true };
  running = true;
  // отметка в базе переживает перезапуск: иначе оборванный деплоем прогон исчезает молча
  await setState('run_started', new Date().toISOString()).catch(() => {});
  const work = runPipelineInner(onStage);
  work.finally(async () => {
    running = false;
    await setState('run_started', null).catch(() => {});
  });
  // ждём не дольше предела — сам прогон при этом продолжается
  return Promise.race([work, timeoutIn(TIMEOUT_MIN)]);
}

async function runPipelineInner(onStage) {
  const stage = (text) => { try { onStage(text); } catch { /* отчёт не должен ронять прогон */ } };
  try {
    stage('собираю ленту');
    await collectAll();
    await refreshLibrary().catch((e) => console.warn(`[library] refresh failed: ${e.message}`));
    stage('группирую и оцениваю сюжеты');
    await clusterNewItems();
    await scoreNew();
    // Аналитика трендов: сущности из новых заметок, Google Trends, поисковые подсказки
    await runTrends({ onStage: (what) => stage(`тренды — ${what}`) }).catch((e) => console.warn(`[trends] прогон не удался: ${e.message}`));

    const format = formatForNextSlot();
    console.log(`[pipeline] format: ${format.title}`);
    // Под конкретный формат подходит не каждый сюжет — берём кандидатов с запасом
    stage(`пишу черновики, формат «${format.title}»`);
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
    await setState('last_pipeline_finished', new Date().toISOString()).catch(() => {});
  }
}

module.exports = { runPipeline, redraft, cleanSlop, draftFromSource, draftFromItem, draftFromTrend, trendItemCount, pickFormat, scoreNew, __draftPost: draftPost };

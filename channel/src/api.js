const http = require('http');
const crypto = require('crypto');
const { pool } = require('./db');
const { formatByKey } = require('./formats');
const sources = require('./sources');
const { buildSchedule } = require('./schedule');
const { findSlop } = require('./slop');
const actions = require('./actions');
const { refreshLibrary, STALE_MS } = require('./library');

// Закрытый API для страницы «Канал» в админке игры: список постов и действия с ними.
// Включается, только если задан CHANNEL_API_TOKEN; запрос должен нести его в заголовке x-channel-token
const TOKEN = process.env.CHANNEL_API_TOKEN || '';

const STATUSES = {
  draft: ['draft'],
  approved: ['approved'],
  published: ['published'],
  deferred: ['deferred'],
  all: ['draft', 'approved', 'published', 'deferred'],
};

function authorized(req) {
  const got = Buffer.from(String(req.headers['x-channel-token'] || ''));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

async function listPosts(status) {
  const { rows } = await pool.query(
    `SELECT p.id, p.status, p.format, p.text, p.image_url, p.created_at, p.approved_at, p.published_at,
            p.channel_message_id, i.thesis, i.lens
     FROM posts p JOIN insights i ON i.id = p.insight_id
     WHERE p.status = ANY($1)
     ORDER BY COALESCE(p.published_at, p.approved_at, p.created_at) DESC
     LIMIT 200`,
    [STATUSES[status] || STATUSES.all]
  );
  const { rows: counts } = await pool.query(`SELECT status, COUNT(*)::int AS n FROM posts GROUP BY status`);
  return {
    posts: rows.map((p) => ({
      ...p,
      format_title: formatByKey(p.format)?.title ?? null,
      slop: findSlop(p.text).map((h) => h.match),
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  };
}

// Источники с описанием, тегами и статистикой: сколько заметок дали и что из них вышло
async function listSources() {
  const { rows: stats } = await pool.query(`
    SELECT feed,
           COUNT(*) FILTER (WHERE fetched_at > NOW() - INTERVAL '7 days')::int AS week,
           COUNT(*)::int AS total,
           MAX(published_at) AS last_published
    FROM items WHERE feed IS NOT NULL GROUP BY feed`);
  const { rows: used } = await pool.query(`
    SELECT i.feed, COUNT(DISTINCT p.id)::int AS posts
    FROM items i
    JOIN insights ins ON ins.cluster_id = i.cluster_id
    JOIN posts p ON p.insight_id = ins.id AND p.status IN ('approved', 'published')
    WHERE i.feed IS NOT NULL GROUP BY i.feed`);
  const byFeed = Object.fromEntries(stats.map((r) => [r.feed, r]));
  const postsByFeed = Object.fromEntries(used.map((r) => [r.feed, r.posts]));

  return {
    sources: sources.map((s) => ({
      name: s.name,
      description: s.description || null,
      tags: s.tags || [],
      layer: s.layer,
      kind: s.type === 'telegram' ? 'telegram'
        : s.type === 'sitemap' ? 'карта сайта'
        : String(s.url).includes('news.google') ? 'поиск новостей' : 'RSS',
      url: s.type === 'telegram' ? `https://t.me/s/${s.channel}` : String([].concat(s.url)[0]),
      week: byFeed[s.name]?.week ?? 0,
      total: byFeed[s.name]?.total ?? 0,
      last_published: byFeed[s.name]?.last_published ?? null,
      posts: postsByFeed[s.name] ?? 0,
    })),
  };
}

// Каталог картинок игры (эскизы и рендеры) для выбора в админке
async function listLibrary({ force = false } = {}) {
  // свежие эскизы и рендеры из игры подтягиваем при открытии выбора картинки
  await refreshLibrary(force ? 0 : STALE_MS).catch((e) => console.warn(`[api] library refresh: ${e.message}`));
  const { rows } = await pool.query(
    `SELECT image_id, outfit_id, kind, title, descriptor, thumb_url, created_at
     FROM library ORDER BY created_at DESC NULLS LAST, title`
  );
  const { rows: [counts] } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE kind = 'sketch')::int AS sketches,
           COUNT(*) FILTER (WHERE kind = 'render')::int AS renders,
           COUNT(DISTINCT outfit_id)::int AS outfits
    FROM library`);
  return { images: rows, counts };
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new actions.ActionError('Слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new actions.ActionError('Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

// POST /api/posts/:id/action {action} · /text {text} · /redraft {feedback}
const ACTIONS = {
  approve: (id) => actions.approve(id, 'admin'),
  now: (id) => actions.publishNow(id),
  defer: (id) => actions.defer(id, 'admin'),
  reject: (id) => actions.reject(id, 'admin'),
  noimg: (id) => actions.removeImage(id, 'admin'),
};

async function handleWrite(req, res, id, op) {
  const body = await readJson(req);
  if (op === 'action') {
    const fn = ACTIONS[body.action];
    if (!fn) return send(res, 400, { error: 'Неизвестное действие' });
    await fn(id);
    return send(res, 200, { ok: true });
  }
  if (op === 'image') {
    await actions.setImage(id, body.image_id || null);
    return send(res, 200, { ok: true });
  }
  if (op === 'text') {
    await actions.editText(id, body.text);
    return send(res, 200, { ok: true });
  }
  if (op === 'redraft') {
    // Правка через модель идёт 1–2 минуты — отвечаем сразу, результат появится в списке и в боте
    const feedback = String(body.feedback || '').trim();
    if (!feedback) return send(res, 400, { error: 'Комментарий пустой' });
    const { rows: [p] } = await pool.query('SELECT status FROM posts WHERE id = $1', [id]);
    if (!p || !['draft', 'deferred', 'approved'].includes(p.status)) return send(res, 409, { error: 'Этот пост уже нельзя править' });
    actions.redraftWithFeedback(id, feedback, 'admin').catch((e) => console.error('[api] redraft failed', e));
    return send(res, 202, { ok: true, pending: true });
  }
  return send(res, 404, { error: 'Not found' });
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function startApi() {
  if (!TOKEN) {
    console.log('[api] CHANNEL_API_TOKEN не задан — API для админки выключен');
    return;
  }
  const port = Number(process.env.PORT || 3002);
  http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' });
      if (req.method === 'GET' && url.pathname === '/api/posts') {
        return send(res, 200, await listPosts(url.searchParams.get('status') || 'all'));
      }
      if (req.method === 'GET' && url.pathname === '/api/library') {
        return send(res, 200, await listLibrary({ force: url.searchParams.get('refresh') === '1' }));
      }
      if (req.method === 'GET' && url.pathname === '/api/sources') return send(res, 200, await listSources());
      if (req.method === 'GET' && url.pathname === '/api/schedule') {
        return send(res, 200, await buildSchedule(Math.min(30, Number(url.searchParams.get('days')) || 14)));
      }
      const write = url.pathname.match(/^\/api\/posts\/(\d+)\/(action|text|redraft|image)$/);
      if (req.method === 'POST' && write) return await handleWrite(req, res, Number(write[1]), write[2]);
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (e instanceof actions.ActionError) return send(res, 409, { error: e.message });
      console.error('[api]', e);
      return send(res, 500, { error: 'Internal error' });
    }
  }).listen(port, () => console.log(`[api] listening on :${port}`));
}

module.exports = { startApi };

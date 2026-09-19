const http = require('http');
const crypto = require('crypto');
const { pool } = require('./db');
const { formatByKey } = require('./formats');
const { findSlop } = require('./slop');

// Закрытый API только на чтение — для страницы «Канал» в админке игры.
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
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      console.error('[api]', e);
      return send(res, 500, { error: 'Internal error' });
    }
  }).listen(port, () => console.log(`[api] listening on :${port}`));
}

module.exports = { startApi };

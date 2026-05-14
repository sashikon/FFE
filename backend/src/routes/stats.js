const express = require('express');
const pool = require('../db');
const { requireAdminToken } = require('../middleware/auth');

const router = express.Router();

function parseDevice(ua) {
  if (!ua) return 'Unknown';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android.*Mobile/.test(ua)) return 'Android Phone';
  if (/Android/.test(ua)) return 'Android Tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Other';
}

// POST /api/game/session — save completed game (public)
router.post('/game/session', async (req, res, next) => {
  try {
    const { outfit_id, lang, score, total, answers, session_id } = req.body;
    if (!outfit_id || !lang || score == null || !total) {
      return res.status(400).json({ error: 'outfit_id, lang, score, total required' });
    }
    const user_agent = req.headers['user-agent'] || null;
    await pool.query(
      `INSERT INTO game_sessions (outfit_id, lang, score, total, answers, session_id, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [outfit_id, lang, score, total, JSON.stringify(answers || []), session_id || null, user_agent]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats — aggregate stats per outfit
router.get('/admin/stats', requireAdminToken, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        o.id,
        o.title,
        o.thumb_url,
        COUNT(s.id)::int                          AS plays,
        COUNT(DISTINCT s.session_id)::int         AS unique_players,
        ROUND(AVG(s.score)::numeric, 1)           AS avg_score,
        MAX(s.total)                              AS total,
        jsonb_agg(
          jsonb_build_object('score', s.score, 'lang', s.lang, 'answers', s.answers, 'user_agent', s.user_agent, 'created_at', s.created_at)
          ORDER BY s.created_at DESC
        ) FILTER (WHERE s.id IS NOT NULL)         AS sessions
      FROM outfits o
      LEFT JOIN game_sessions s ON s.outfit_id = o.id
      GROUP BY o.id, o.title, o.thumb_url
      ORDER BY plays DESC, o.created_at DESC
    `);

    const stats = rows.map((outfit) => {
      const sessions = outfit.sessions || [];

      // Per-row accuracy
      const rowAccuracy = {};
      sessions.forEach(({ answers }) => {
        if (!Array.isArray(answers)) return;
        answers.forEach(({ row_index, correct }) => {
          if (!rowAccuracy[row_index]) rowAccuracy[row_index] = { correct: 0, total: 0 };
          rowAccuracy[row_index].total += 1;
          if (correct) rowAccuracy[row_index].correct += 1;
        });
      });
      const rowStats = Object.entries(rowAccuracy).map(([i, v]) => ({
        row_index: Number(i),
        accuracy: v.total ? Math.round((v.correct / v.total) * 100) : null,
        plays: v.total,
      })).sort((a, b) => a.row_index - b.row_index);

      // Device breakdown
      const devices = {};
      sessions.forEach(({ user_agent }) => {
        const d = parseDevice(user_agent);
        devices[d] = (devices[d] || 0) + 1;
      });

      return {
        id: outfit.id,
        title: outfit.title,
        thumb_url: outfit.thumb_url,
        plays: outfit.plays,
        unique_players: outfit.unique_players,
        avg_score: outfit.avg_score,
        total: outfit.total,
        rows: rowStats,
        devices,
      };
    });

    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

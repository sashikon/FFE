const express = require('express');
const pool = require('../db');
const { requireAdminToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/game/session — save completed game (public)
router.post('/game/session', async (req, res, next) => {
  try {
    const { outfit_id, lang, score, total, answers } = req.body;
    if (!outfit_id || !lang || score == null || !total) {
      return res.status(400).json({ error: 'outfit_id, lang, score, total required' });
    }
    await pool.query(
      `INSERT INTO game_sessions (outfit_id, lang, score, total, answers)
       VALUES ($1, $2, $3, $4, $5)`,
      [outfit_id, lang, score, total, JSON.stringify(answers || [])]
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
        ROUND(AVG(s.score)::numeric, 1)           AS avg_score,
        MAX(s.total)                              AS total,
        jsonb_agg(
          jsonb_build_object('score', s.score, 'lang', s.lang, 'answers', s.answers, 'created_at', s.created_at)
          ORDER BY s.created_at DESC
        ) FILTER (WHERE s.id IS NOT NULL)         AS sessions
      FROM outfits o
      LEFT JOIN game_sessions s ON s.outfit_id = o.id
      GROUP BY o.id, o.title, o.thumb_url
      ORDER BY plays DESC, o.created_at DESC
    `);

    // Compute per-row accuracy from answers
    const stats = rows.map((outfit) => {
      const sessions = outfit.sessions || [];
      const rowAccuracy = {};
      sessions.forEach(({ answers }) => {
        if (!Array.isArray(answers)) return;
        answers.forEach(({ row_index, correct }) => {
          if (!rowAccuracy[row_index]) rowAccuracy[row_index] = { correct: 0, total: 0 };
          rowAccuracy[row_index].total += 1;
          if (correct) rowAccuracy[row_index].correct += 1;
        });
      });
      const rows = Object.entries(rowAccuracy).map(([i, v]) => ({
        row_index: Number(i),
        accuracy: v.total ? Math.round((v.correct / v.total) * 100) : null,
        plays: v.total,
      })).sort((a, b) => a.row_index - b.row_index);

      return {
        id: outfit.id,
        title: outfit.title,
        thumb_url: outfit.thumb_url,
        plays: outfit.plays,
        avg_score: outfit.avg_score,
        total: outfit.total,
        rows,
      };
    });

    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

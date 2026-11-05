const express = require('express');
const crypto = require('crypto');
const pool = require('../db');

const router = express.Router();

// POST /api/visual-click { c, referrer } — открыта всем: её зовёт публичный сайт,
// когда по ссылке пина коллажа пришёл посетитель. Ничего не возвращает наружу, кроме ok
router.post('/visual-click', async (req, res) => {
  try {
    const c = String(req.body?.c || '').toLowerCase();
    if (!/^[0-9a-f]{8}$/.test(c)) return res.status(400).json({ ok: false });

    const { rows } = await pool.query(`SELECT id FROM visuals WHERE id::text LIKE $1 LIMIT 2`, [`${c}%`]);
    if (rows.length !== 1) return res.json({ ok: false }); // нет такого или неоднозначно

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const day = new Date().toISOString().slice(0, 10);
    const visitor = crypto.createHash('sha256').update(`${ip}|${req.headers['user-agent'] || ''}|${day}`).digest('hex').slice(0, 16);
    const fromPinterest = /pinterest\./i.test(String(req.body?.referrer || ''));

    // Один посетитель — один переход по пину за сутки
    await pool.query(
      `INSERT INTO visual_clicks (visual_id, visitor, from_pinterest)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM visual_clicks WHERE visual_id = $1 AND visitor = $2 AND created_at > NOW() - INTERVAL '1 day'
       )`,
      [rows[0].id, visitor, fromPinterest]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[visual-click]', err.message);
    res.json({ ok: false }); // учёт переходов не должен ломать сайт
  }
});

module.exports = router;

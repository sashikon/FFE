require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const runMigrations = require('./db/migrate');

const outfitsRouter = require('./routes/outfits');
const uploadRouter = require('./routes/upload');
const adminRouter = require('./routes/admin');
const statsRouter = require('./routes/stats');
const { analyzeOutfit } = require('./llm/pipeline');
const { enqueue } = require('./queue');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: (origin, cb) => {
    const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',');
    // разрешаем любой localhost в dev
    if (!origin || allowed.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

app.use('/api', outfitsRouter);
app.use('/api', uploadRouter);
app.use('/api/admin', adminRouter);
app.use('/api', statsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function recoverPending() {
  const { rows } = await pool.query(`
    SELECT DISTINCT o.id, o.image_url
    FROM outfits o
    JOIN outfit_translations t ON t.outfit_id = o.id
    WHERE t.status = 'pending'
  `);
  if (rows.length) {
    console.log(`Recovering ${rows.length} pending outfit(s)...`);
    rows.forEach(({ id, image_url }) => {
      enqueue(() => analyzeOutfit(image_url, id)).catch((e) =>
        console.error('recover analyzeOutfit failed', id, e)
      );
    });
  }
}

async function start() {
  await runMigrations();
  await recoverPending();
  app.listen(PORT, () => console.log(`FFE backend listening on :${PORT}`));
}

start().catch((err) => { console.error(err); process.exit(1); });

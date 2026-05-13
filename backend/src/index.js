require('dotenv').config();
const express = require('express');
const cors = require('cors');

const outfitsRouter = require('./routes/outfits');
const uploadRouter = require('./routes/upload');
const adminRouter = require('./routes/admin');

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

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => console.log(`FFE backend listening on :${PORT}`));

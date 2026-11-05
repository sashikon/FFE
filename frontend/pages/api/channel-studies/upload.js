import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

// Загрузка исследования частями: завести (upload) → дописывать куски (part) → пустить в работу (start).
// Между браузером и сервисом канала стоит Vercel с пределом 4,5 МБ на запрос,
// поэтому длинный текст приходит кусками и собирается уже в базе канала
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const STEPS = {
  upload: () => '/api/studies/upload',
  part: (id) => `/api/studies/${id}/part`,
  start: (id) => `/api/studies/${id}/start`,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const step = STEPS[req.query.step];
  const id = Number(req.query.id || 0);
  if (!step) return res.status(400).json({ error: 'Неизвестный шаг загрузки' });
  if (req.query.step !== 'upload' && !id) return res.status(400).json({ error: 'Не указан номер исследования' });

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}${step(id)}`, {
      method: 'POST',
      headers: { 'x-channel-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(120000),
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

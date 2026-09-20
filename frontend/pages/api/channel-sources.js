import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';

// Источники канала с описанием, тегами и статистикой
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/sources`, {
      headers: { 'x-channel-token': token },
      signal: AbortSignal.timeout(20000),
    });
    const body = await r.json().catch(() => ({}));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).json(body);
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

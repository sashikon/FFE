import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';

// Состояние прогона и его запуск вручную.
// Запуск отвечает сразу (202): сам прогон идёт минутами, ход видно в GET
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/run`, {
      method: req.method,
      headers: { 'x-channel-token': token, 'Content-Type': 'application/json' },
      ...(req.method === 'POST' ? { body: '{}' } : {}),
      signal: AbortSignal.timeout(30000),
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

// Прокси к закрытому API сервиса канала: токен живёт только на сервере (не NEXT_PUBLIC_),
// доступ — только после входа в админку через GitHub
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  // адрес из Railway часто вставляют без https:// — дописываем
  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) {
    return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });
  }

  const status = ['all', 'draft', 'approved', 'published', 'deferred'].includes(req.query.status) ? req.query.status : 'all';
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/posts?status=${status}`, {
      headers: { 'x-channel-token': token },
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).json(body);
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

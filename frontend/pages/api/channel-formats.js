import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';

// Список форматов канала для выбора в карточке поста
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/formats`, {
      headers: { 'x-channel-token': token },
      signal: AbortSignal.timeout(15000),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

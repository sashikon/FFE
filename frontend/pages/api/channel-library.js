import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';

// Каталог образов игры для выбора картинки к посту
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const refresh = req.query.refresh === '1' ? '?refresh=1' : '';
    const r = await fetch(`${base.replace(/\/$/, '')}/api/library${refresh}`, {
      headers: { 'x-channel-token': token },
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.json().catch(() => ({}));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).json(body);
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

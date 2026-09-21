import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

// Определить формат у всех постов, где он не задан
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/posts/format-all`, {
      method: 'POST',
      headers: { 'x-channel-token': token, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(120000),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

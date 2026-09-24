import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

// Черновик поста из темы трендов: берутся заметки, в которых тема всплывала
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (!/^\d+$/.test(String(req.query.id))) return res.status(400).json({ error: 'Bad request' });

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/trends/${req.query.id}/draft`, {
      method: 'POST',
      headers: { 'x-channel-token': token, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

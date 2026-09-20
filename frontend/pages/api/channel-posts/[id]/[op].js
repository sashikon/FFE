import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';

// Действия с постом канала из админки: POST /api/channel-posts/:id/(action|text|redraft).
// Та же схема, что у списка: сессия GitHub + токен только на сервере
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const { id, op } = req.query;
  if (!/^\d+$/.test(id) || !['action', 'text', 'redraft', 'image', 'format'].includes(op)) return res.status(400).json({ error: 'Bad request' });

  // адрес из Railway часто вставляют без https:// — дописываем
  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/posts/${id}/${op}`, {
      method: 'POST',
      headers: { 'x-channel-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(60000),
    });
    const body = await r.json().catch(() => ({}));
    return res.status(r.status).json(body);
  } catch (e) {
    return res.status(502).json({ error: `Сервис канала недоступен: ${e.message}` });
  }
}

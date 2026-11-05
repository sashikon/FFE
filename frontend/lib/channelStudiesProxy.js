import { getServerSession } from 'next-auth/next';
import { authOptions } from '../pages/api/auth/[...nextauth]';

// Общая часть прокси к исследованиям. Шаги загрузки разведены по отдельным файлам:
// так у каждого адреса API канала ровно один прокси, и проверка check:admin
// сверяет их один к одному
export async function proxyStudy(req, res, pathFor, { needsId = false } = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const id = Number(req.query.id || 0);
  if (needsId && !id) return res.status(400).json({ error: 'Не указан номер исследования' });

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).json({ error: 'CHANNEL_API_URL / CHANNEL_API_TOKEN не заданы в переменных Vercel' });

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}${pathFor(id)}`, {
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

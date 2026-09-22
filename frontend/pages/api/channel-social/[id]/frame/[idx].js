import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]';

// Кадр ролика или скриншот — картинка отдаётся через сервер, ключ в браузер не попадает
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).end();
  const { id, idx } = req.query;
  if (!/^\d+$/.test(String(id)) || !/^\d+$/.test(String(idx))) return res.status(400).end();

  const raw = (process.env.CHANNEL_API_URL || '').trim();
  const base = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw;
  const token = process.env.CHANNEL_API_TOKEN;
  if (!base || !token) return res.status(503).end();

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/social/${id}/frame/${idx}`, {
      headers: { 'x-channel-token': token },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return res.status(r.status).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    return res.status(502).end();
  }
}

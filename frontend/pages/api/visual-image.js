import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';

// Отдаёт картинку из Cloudinary с нашего домена, чтобы сборщик коллажа мог нарисовать её
// на canvas и сохранить результат: браузер запрещает выгружать canvas с чужими картинками,
// если их сервер не разрешил это явно. Пускает только адреса Cloudinary и только админов.
// Картинку уменьшаем на стороне Cloudinary: ответ функции Vercel ограничен по размеру
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  let url;
  try {
    url = new URL(String(req.query.url || ''));
  } catch {
    return res.status(400).json({ error: 'Нужен адрес картинки' });
  }
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || !url.pathname.includes('/image/upload/')) {
    return res.status(400).json({ error: 'Поддерживаются только картинки из Cloudinary' });
  }
  url.pathname = url.pathname.replace('/image/upload/', '/image/upload/w_1600,h_1600,c_limit,q_90,f_jpg/');

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.status(502).json({ error: `Cloudinary ответил ${r.status}` });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: `Не удалось получить картинку: ${e.message}` });
  }
}

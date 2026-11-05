import { proxyStudy } from '../../../lib/channelStudiesProxy';

// Текст загружен целиком — проверить длину и пустить в работу
export default function handler(req, res) {
  return proxyStudy(req, res, (id) => `/api/studies/${id}/start`, { needsId: true });
}

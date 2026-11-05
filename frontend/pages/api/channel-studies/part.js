import { proxyStudy } from '../../../lib/channelStudiesProxy';

// Дописать очередной кусок текста
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default function handler(req, res) {
  return proxyStudy(req, res, (id) => `/api/studies/${id}/part`, { needsId: true });
}

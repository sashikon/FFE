import { proxyStudy } from '../../../lib/channelStudiesProxy';

// Завести исследование перед загрузкой частями
export default function handler(req, res) {
  return proxyStudy(req, res, () => '/api/studies/upload');
}

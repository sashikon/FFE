export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send('pinterest-site-verification=79c5757f6080fdfebdab8167d6cfb483');
}

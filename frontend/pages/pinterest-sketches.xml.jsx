import { buildFeed, fetchFeedItems } from '../lib/pinterestFeed';

export default function Feed() {
  return null;
}

export async function getServerSideProps({ res }) {
  let items = [];
  try {
    items = await fetchFeedItems('sketches');
  } catch (e) {
    console.error('[pinterest-feed] sketches:', e.message);
  }
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=900');
  res.write(buildFeed('sketches', items));
  res.end();
  return { props: {} };
}

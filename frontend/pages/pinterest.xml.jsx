import { buildFeed, fetchFeedItems } from '../lib/pinterestFeed';

export default function Feed() {
  return null;
}

export async function getServerSideProps({ res }) {
  let items = [];
  try {
    items = await fetchFeedItems('renders');
  } catch (e) {
    console.error('[pinterest-feed] renders:', e.message);
  }
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=900');
  res.write(buildFeed('renders', items));
  res.end();
  return { props: {} };
}

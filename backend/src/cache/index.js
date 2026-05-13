const Redis = require('ioredis');

const GAME_TTL = 60 * 60 * 24; // 24h

let redis = null;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('error', (err) => console.warn('redis unavailable:', err.message));
}

async function getGameRows(outfitId, lang) {
  if (!redis) return null;
  try {
    const cached = await redis.get(`game:${outfitId}:${lang}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

async function setGameRows(outfitId, lang, rows) {
  if (!redis) return;
  try {
    await redis.setex(`game:${outfitId}:${lang}`, GAME_TTL, JSON.stringify(rows));
  } catch {}
}

async function invalidate(outfitId) {
  if (!redis) return;
  try {
    await redis.del(`game:${outfitId}:ru`, `game:${outfitId}:en`);
  } catch {}
}

module.exports = { getGameRows, setGameRows, invalidate };

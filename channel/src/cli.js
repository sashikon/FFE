// Ручной запуск без бота:
//   npm run collect   — только сбор, кластеризация и отбор, печатает лучшие сюжеты
//   npm run run-once  — полный прогон с отправкой черновиков
require('dotenv').config();
const { pool, runMigrations } = require('./db');
const { collectAll } = require('./collect');
const { clusterNewItems } = require('./cluster');

async function main() {
  await runMigrations();
  const cmd = process.argv[2];

  if (cmd === 'collect') {
    await collectAll();
    await clusterNewItems();
    if (process.env.ANTHROPIC_API_KEY) {
      const { scoreNew } = require('./pipeline');
      await scoreNew();
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.score, c.lens, c.score_reason, MIN(i.title) AS title, COUNT(i.id)::int AS n
       FROM clusters c JOIN items i ON i.cluster_id = c.id
       WHERE c.created_at > NOW() - INTERVAL '72 hours'
       GROUP BY c.id ORDER BY c.score DESC NULLS LAST, n DESC LIMIT 25`
    );
    console.table(rows);
  } else if (cmd === 'run') {
    const { runPipeline } = require('./pipeline');
    console.log(await runPipeline());
  } else {
    console.log('usage: node src/cli.js collect|run');
  }
  await pool.end();
  process.exit(0); // rss-parser держит keep-alive сокеты
}

main().catch((e) => { console.error(e); process.exit(1); });

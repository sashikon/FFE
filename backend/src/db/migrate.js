require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./index');

async function run() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running ${file}…`);
    await pool.query(sql);
    console.log(`  ✓ ${file}`);
  }

  console.log('All migrations complete');
  await pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });

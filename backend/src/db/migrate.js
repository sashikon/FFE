require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./index');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/001_init.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration complete');
  await pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });

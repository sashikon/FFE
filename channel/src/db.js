const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => console.error('pg pool error', err));

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rows.length) continue;
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    console.log(`[migrate] applied ${file}`);
  }
}

async function getState(key) {
  const { rows } = await pool.query('SELECT value FROM bot_state WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

async function setState(key, value) {
  await pool.query(
    `INSERT INTO bot_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

module.exports = { pool, runMigrations, getState, setState };

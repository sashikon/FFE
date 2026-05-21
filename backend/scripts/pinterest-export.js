#!/usr/bin/env node
// Generates pinterest.csv for Pinterest bulk pin upload.
// Usage: node scripts/pinterest-export.js [--lang en] [--board "FFE"] [--out pinterest.csv]
//
// Requires DATABASE_URL in environment (.env or shell).
// Only exports outfits with status='ready' translations.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://ffe-blush.vercel.app';
const TITLE_MAX = 100;
const DESC_MAX = 500;
const PINS_PER_BATCH = 200; // Pinterest hard limit per upload

// --- CLI args ---
const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const LANG = get('--lang', 'en');
const BOARD = get('--board', 'FFE');
const OUT_FILE = path.resolve(get('--out', 'pinterest.csv'));

// --- CSV helpers ---
function csvCell(value) {
  if (value == null) return '';
  const s = String(value).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

// --- Description builder ---
// Brand voice: precise, no theory, no "because/therefore".
// Format: "5 layers. Find the odd word. {theme1} · {theme2} · {theme3} · {theme4} · {theme5}"
function buildDescription(gameRows) {
  if (!Array.isArray(gameRows) || !gameRows.length) return '';
  const themes = gameRows.map((r) => r.theme).filter(Boolean).join(' · ');
  const hook = LANG === 'ru'
    ? 'Пять слоёв. Одно лишнее слово.'
    : 'Five layers. One odd word.';
  const desc = `${hook} ${themes}`;
  return desc.slice(0, DESC_MAX);
}

// --- Keywords builder ---
// Take all option words from all game rows, deduplicate, join with comma.
function buildKeywords(gameRows) {
  if (!Array.isArray(gameRows)) return '';
  const base = LANG === 'ru'
    ? ['мода', 'образ', 'семиотика', 'стиль', 'насмотренность']
    : ['fashion', 'outfit', 'style', 'fashion game', 'fashion literacy'];
  const words = new Set(base);
  for (const row of gameRows) {
    for (const opt of row.options || []) {
      if (opt && opt.length <= 30) words.add(opt.toLowerCase());
    }
  }
  return [...words].join(', ');
}

// --- Main ---
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query(
    `SELECT o.id, o.image_url, o.thumb_url, o.render_url, o.title,
            t.game_rows
     FROM outfits o
     JOIN outfit_translations t ON t.outfit_id = o.id AND t.lang = $1
     WHERE t.status = 'ready'
     ORDER BY o.created_at DESC`,
    [LANG]
  );

  await pool.end();

  if (!rows.length) {
    console.error(`No ready outfits found for lang="${LANG}". Run the LLM pipeline first.`);
    process.exit(1);
  }

  const header = ['Title', 'Pinterest board', 'Media URL', 'Thumbnail', 'Description', 'Link', 'Publish date', 'Keywords'];

  const csvLines = [csvRow(header)];

  for (const outfit of rows) {
    const gameRows = outfit.game_rows || [];

    const title = (outfit.title || (LANG === 'ru' ? 'Читай образ' : 'Read this outfit'))
      .slice(0, TITLE_MAX);

    const description = buildDescription(gameRows);
    const keywords = buildKeywords(gameRows);
    const link = `${BASE_URL}/outfit/${outfit.id}?lang=${LANG}`;
    const thumbnail = outfit.thumb_url || '';

    // Prefer render_url for Pinterest; fall back to image_url (sketch)
    const mediaUrl = outfit.render_url || outfit.image_url;
    if (!outfit.render_url) {
      console.warn(`⚠  No render for outfit ${outfit.id} (${outfit.title || 'untitled'}) — using sketch as fallback`);
    }

    csvLines.push(csvRow([
      title,
      BOARD,
      mediaUrl,
      thumbnail,
      description,
      link,
      '',       // Publish date — blank = publish immediately
      keywords,
    ]));
  }

  // Split into batches of 200 if needed
  const dataLines = csvLines.slice(1);
  const batches = Math.ceil(dataLines.length / PINS_PER_BATCH);

  if (batches === 1) {
    fs.writeFileSync(OUT_FILE, csvLines.join('\n'), 'utf8');
    console.log(`✓ ${dataLines.length} pins → ${OUT_FILE}`);
  } else {
    const ext = path.extname(OUT_FILE);
    const base = OUT_FILE.slice(0, -ext.length);
    for (let i = 0; i < batches; i++) {
      const chunk = [csvLines[0], ...dataLines.slice(i * PINS_PER_BATCH, (i + 1) * PINS_PER_BATCH)];
      const batchFile = `${base}_${i + 1}${ext}`;
      fs.writeFileSync(batchFile, chunk.join('\n'), 'utf8');
      console.log(`✓ Batch ${i + 1}/${batches}: ${chunk.length - 1} pins → ${batchFile}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

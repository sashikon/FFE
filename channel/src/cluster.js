const { pool } = require('./db');

// Грубая, но бесплатная кластеризация: пересечение значимых слов заголовков (Жаккар).
// Когда станет тесно — заменить на эмбеддинги, интерфейс clusterNewItems() не изменится.
const THRESHOLD = 0.3;
const WINDOW = '72 hours';

const STOP = new Set(`
  about after again against also among amid and are back been before being between both
  brand brands but can could down during each fashion first from has have her his how into
  its just launch launches like more most new news not now off only other our out over
  says season should since some than that the their them then there these they this
  those through under until week what when where which while who why will with would year your
  как что это для или все при его она они над под без про тем чем где когда если уже еще ещё
  только также этот эта эти того тоже было были будет может новый новая новые года году мода моды
`.split(/\s+/).filter(Boolean));

// Сезоны и годы склеивают разные показы в один «сюжет»
const SEASON = /^(spring|summer|fall|autumn|winter|resort|pre|ready|wear|menswear|womenswear|couture|collection|show|runway|\d{4})$/;

function tokens(title) {
  return new Set(
    title.toLowerCase()
      .replace(/[’']s\b/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !SEASON.test(w))
  );
}

function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

async function clusterNewItems() {
  const { rows: fresh } = await pool.query(
    `SELECT id, title FROM items WHERE cluster_id IS NULL ORDER BY id`
  );
  if (!fresh.length) return 0;

  const { rows: recent } = await pool.query(
    `SELECT id, title, cluster_id FROM items
     WHERE cluster_id IS NOT NULL AND fetched_at > NOW() - INTERVAL '${WINDOW}'`
  );
  const known = recent.map((r) => ({ ...r, tok: tokens(r.title) }));
  let created = 0;

  for (const item of fresh) {
    const tok = tokens(item.title);
    let best = null;
    for (const k of known) {
      const s = jaccard(tok, k.tok);
      if (s >= THRESHOLD && (!best || s > best.s)) best = { s, cluster_id: k.cluster_id };
    }

    let clusterId = best?.cluster_id;
    if (!clusterId) {
      const { rows } = await pool.query('INSERT INTO clusters DEFAULT VALUES RETURNING id');
      clusterId = rows[0].id;
      created++;
    }
    await pool.query('UPDATE items SET cluster_id = $1 WHERE id = $2', [clusterId, item.id]);
    known.push({ id: item.id, title: item.title, cluster_id: clusterId, tok });
  }

  console.log(`[cluster] ${fresh.length} items → ${created} new clusters`);
  return created;
}

async function clusterItems(clusterId) {
  const { rows } = await pool.query(
    `SELECT source, layer, url, title, summary, published_at
     FROM items WHERE cluster_id = $1 ORDER BY published_at DESC NULLS LAST`,
    [clusterId]
  );
  return rows;
}

module.exports = { clusterNewItems, clusterItems };

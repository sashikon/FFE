const pool = require('./db');

// Настройки из админки. Значения по умолчанию — прежние зашитые названия досок,
// чтобы ничего не сломалось до первого сохранения
const DEFAULTS = {
  pinterest: {
    export_board: 'FFE',               // название доски в CSV-выгрузке
    sketch_board: 'Fashion sketch',    // доска с эскизами — по ней импорт узнаёт пины эскизов
    collage_board: 'Collage Item Pins', // доска-коллаж — её пины при импорте пропускаются
    collage_csv_board: '', // доска в CSV коллажей из «Композиций»; пусто — та же, что export_board
    profile: '', // имя профиля Pinterest для ссылок на доски; пусто — берём из API
  },
};

async function getSettings(key) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return { ...(DEFAULTS[key] || {}), ...(rows[0]?.value || {}) };
}

// Сохраняем только известные поля; пустое значение возвращает поле к значению по умолчанию
async function saveSettings(key, patch) {
  const current = await getSettings(key);
  const allowed = Object.keys(DEFAULTS[key] || {});
  const next = { ...current };
  for (const field of allowed) {
    if (!(field in patch)) continue;
    const value = String(patch[field] ?? '').trim();
    next[field] = value || DEFAULTS[key][field];
  }
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(next)]
  );
  return next;
}

module.exports = { getSettings, saveSettings, DEFAULTS };

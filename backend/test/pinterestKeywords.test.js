// node --test backend/test — ключевые слова для выгрузки пинов
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildKeywords, MAX_TOTAL } = require('../src/pinterestKeywords');

const row = (theme, options, correct) => ({ theme, options, correct });

const trench = {
  gameRows: [
    row('Form', ['trench coat', 'ballet flats', 'pearls', 'sneakers'], 'sneakers'),
    row('Meaning', ['quiet power', 'restraint', 'heritage', 'rebellion'], 'rebellion'),
  ],
  layers: [
    { label: 'тренч', label_en: 'trench coat', is_wrong: false },
    { label: 'балетки', label_en: 'ballet flats', is_wrong: false },
    { label: 'кроссовки', label_en: 'sneakers', is_wrong: true },
    { label: 'образ', label_en: 'outfit', is_wrong: false },
  ],
  aesthetics: { top: [{ name: 'Boardroom & Office Fashion', score: 82 }, { name: 'Evening Outfit Ideas', score: 61 }, { name: 'Streetwear Fashion', score: 20 }] },
};

const corset = {
  gameRows: [row('Details', ['corset', 'lace', 'cherry red', 'hoodie'], 'hoodie')],
  layers: [],
  aesthetics: { top: [{ name: 'Party Outfit Ideas', score: 90 }] },
};

test('разные образы — разное начало списка', () => {
  const a = buildKeywords({ lang: 'en', ...trench });
  const b = buildKeywords({ lang: 'en', ...corset });
  assert.notDeepEqual(a.slice(0, 5), b.slice(0, 5));
});

test('сначала то, что на картинке: эстетики рендера, потом вещи эскиза', () => {
  const k = buildKeywords({ lang: 'en', ...trench });
  assert.deepEqual(k.slice(0, 4), ['boardroom & office fashion', 'evening outfit ideas', 'trench coat', 'ballet flats']);
});

test('эстетика с низкой уверенностью разбора не попадает', () => {
  assert.ok(!buildKeywords({ lang: 'en', ...trench }).includes('streetwear fashion'));
});

test('лишнее слово задания и лишняя вещь эскиза не попадают', () => {
  const k = buildKeywords({ lang: 'en', ...trench });
  assert.ok(!k.includes('sneakers'));
  assert.ok(!k.includes('rebellion'));
  assert.ok(!buildKeywords({ lang: 'en', ...corset }).includes('hoodie'));
});

test('сводный слой «образ» — не вещь', () => {
  assert.ok(!buildKeywords({ lang: 'ru', ...trench }).includes('образ'));
});

test('пока лишняя вещь не отмечена, слои не берём', () => {
  const layers = trench.layers.map((l) => ({ ...l, is_wrong: false }));
  const k = buildKeywords({ lang: 'en', gameRows: [], layers, aesthetics: null });
  assert.ok(!k.includes('sneakers'));
  assert.ok(!k.includes('trench coat'));
});

test('тренды Pinterest — по содержанию образа', () => {
  assert.ok(buildKeywords({ lang: 'en', ...corset }).includes('lace corset outfit'));
  assert.ok(!buildKeywords({ lang: 'en', ...trench }).includes('lace corset outfit'));
});

test('общих фраз немного и они в конце; осенних нет', () => {
  const k = buildKeywords({ lang: 'en', ...trench });
  assert.deepEqual(k.slice(-3), ['outfit ideas', 'aesthetic outfits', 'fashion game']);
  assert.ok(!k.some((w) => w.includes('fall')));
  assert.ok(k.length <= MAX_TOTAL);
});

test('русская выгрузка: русские названия вещей, без английских эстетик', () => {
  const k = buildKeywords({ lang: 'ru', ...trench });
  assert.deepEqual(k.slice(0, 2), ['тренч', 'балетки']);
  assert.ok(!k.includes('boardroom & office fashion'));
  assert.deepEqual(k.slice(-3), ['идеи образов', 'насмотренность', 'стиль']);
});

test('без данных — только общие фразы, без падения', () => {
  assert.deepEqual(buildKeywords({ lang: 'en' }), ['outfit ideas', 'aesthetic outfits', 'fashion game']);
  assert.deepEqual(buildKeywords({ lang: 'en', gameRows: null, layers: null, aesthetics: {} }), ['outfit ideas', 'aesthetic outfits', 'fashion game']);
});

// Ключевые слова пина для CSV-выгрузки в Pinterest.
//
// Сначала — то, что видно на картинке: эстетики из разбора рендера моделью
// и вещи из SVG-слоёв эскиза. Потом слова из заданий игры, и только в конце
// пара общих фраз. Раньше общие фразы (17 штук, с осенними) шли первыми
// у каждого пина, а конкретика дописывалась в хвост — колонка выходила
// одинаковой; вдобавок туда попадало «лишнее» слово задания — то, чего
// в образе нарочно нет.

// Сколько слов всего и сколько из них конкретных. Сколько слов Pinterest
// реально учитывает из колонки Keywords, мы не проверяли — держим список
// коротким, чтобы конкретика не тонула в общем.
const MAX_SPECIFIC = 12;
const MAX_TOTAL = 15;
const MAX_WORD_LEN = 30;

// Порог уверенности разбора рендера (0–100), ниже которого эстетику не берём
const MIN_AESTHETIC_SCORE = 50;

// Сводный слой «образ целиком» — не вещь
const SUMMARY_LABELS = new Set(['образ', 'образ вечерний', 'outfit', 'look', 'total']);

const GENERIC = {
  en: ['outfit ideas', 'aesthetic outfits', 'fashion game'],
  ru: ['идеи образов', 'насмотренность', 'стиль'],
};

// Pinterest Predicts 2025: добавляем, только когда образ про это
const TRENDS = [
  { match: ['rococo', 'baroque', 'ornate', 'embroidered'], add: ['rococo outfit'] },
  { match: ['medieval', 'gothic', 'armor', 'chainmail'], add: ['medieval core'] },
  { match: ['fisherman', 'nautical', 'maritime', 'sailor'], add: ['fisherman aesthetic'] },
  { match: ['moto', 'biker', 'motorcycle'], add: ['moto boho', 'moto boots'] },
  { match: ['boho', 'bohemian', 'festival', 'western'], add: ['moto boho'] },
  { match: ['vamp', 'vampire', 'noir', 'dark academia'], add: ['vamp romantic'] },
  { match: ['cherry', 'scarlet'], add: ['cherry vibes', 'cherry coded'] },
  { match: ['sea', 'ocean', 'witchery', 'ethereal', 'mystical'], add: ['sea witchery'] },
  { match: ['korea', 'korean', 'hanbok'], add: ['korean casual outfits'] },
  { match: ['baggy', 'wide-leg', 'wide leg'], add: ['baggy outfit ideas', 'baggy pants outfit'] },
  { match: ['y2k', 'retro', '2000s'], add: ['y2k winter jacket'] },
  { match: ['fur', 'shearling', 'teddy coat'], add: ['fur coat vintage'] },
  { match: ['vintage', 'thrift', 'secondhand'], add: ['dream thrift finds'] },
  { match: ['preppy', 'ivy league', 'collegiate'], add: ["women's preppy outfits"] },
  { match: ['camel', 'tan', 'coffee', 'mocha', 'brown'], add: ['coffee brown pants outfit'] },
  { match: ['puff sleeve', 'bubble', 'balloon sleeve'], add: ['puff skirt outfit'] },
  { match: ['lace', 'corset'], add: ['lace corset outfit'] },
  { match: ['leopard', 'animal print', 'cheetah'], add: ['leopard print jeans'] },
];

const clean = (s) => String(s || '').trim().toLowerCase();

// Эстетики из разбора картинки: названия уже на английском и сформулированы как поисковые
function aestheticWords(aesthetics, lang) {
  if (lang !== 'en') return [];
  return (aesthetics?.top || [])
    .filter((a) => a?.name && (a.score == null || a.score >= MIN_AESTHETIC_SCORE))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((a) => clean(a.name));
}

// Вещи эскиза. Среди слоёв нарочно есть одна лишняя вещь, которой на эскизе нет;
// пока её не отметили (is_wrong), не знаем какая — и слои не берём совсем
function layerWords(layers, lang) {
  const items = (layers || []).filter((l) => !SUMMARY_LABELS.has(clean(l.label)));
  if (!items.some((l) => l.is_wrong)) return [];
  return items
    .filter((l) => !l.is_wrong)
    .map((l) => clean(lang === 'en' ? l.label_en : l.label))
    .filter(Boolean);
}

// Слова заданий игры без «лишнего» — оно к образу не относится по замыслу
function gameWords(gameRows) {
  const out = [];
  for (const row of Array.isArray(gameRows) ? gameRows : []) {
    const wrong = clean(row.correct);
    for (const opt of row.options || []) {
      const w = clean(opt);
      if (w && w !== wrong) out.push(w);
    }
  }
  return out;
}

function trendWords(text, lang) {
  if (lang !== 'en') return [];
  return TRENDS
    .filter(({ match }) => match.some((m) => text.some((t) => t.includes(m))))
    .flatMap(({ add }) => add);
}

function buildKeywords({ lang = 'en', gameRows = null, layers = null, aesthetics = null } = {}) {
  const seen = aestheticWords(aesthetics, lang);
  const items = layerWords(layers, lang);
  const game = gameWords(gameRows);
  const themes = (Array.isArray(gameRows) ? gameRows : []).map((r) => clean(r.theme)).filter(Boolean);

  const specific = [...new Set([
    ...seen,
    ...items,
    ...trendWords([...seen, ...items, ...game, ...themes], lang),
    ...game,
  ])].filter((w) => w.length <= MAX_WORD_LEN || seen.includes(w)).slice(0, MAX_SPECIFIC);

  const generic = (GENERIC[lang] || GENERIC.en).filter((w) => !specific.includes(w));
  return [...specific, ...generic].slice(0, MAX_TOTAL);
}

module.exports = { buildKeywords, MAX_TOTAL };

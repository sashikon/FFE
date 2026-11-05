const Anthropic = require('@anthropic-ai/sdk');

// SEO-разметка визуала из раздела «Композиции» (чаще всего коллажа) под пин Pinterest.
// Модель смотрит на саму картинку и получает то, что о ней известно: типы композиции, заметку,
// из каких образов и рендеров собран коллаж. По желанию — выжимку загруженной SEO-стратегии
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    title_alt: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['title', 'title_alt', 'description'],
  additionalProperties: false,
};

const RULES = {
  ru: `Пиши по-русски, без хэштегов и без кавычек-ёлочек вокруг всего текста.
- title: 2–7 слов, до 100 знаков. Описательный, редакционный. Пример: «Диагональ в кадре: три образа с акцентом на пальто».
- title_alt: вопрос или крючок, до 100 знаков. Пример: «Что объединяет эти образы?»
- description: 1–3 предложения, 100–300 знаков. Начни с того, что видно на картинке, назови конкретные вещи, цвета, приём композиции; закончи вопросом или приглашением сохранить пин.
- Не выдумывай того, чего нет на картинке и в данных: бренды, сезоны показов, имена.`,
  en: `Write in English, no hashtags.
- title: 3–8 words, max 100 chars. Descriptive, editorial. Example: "Diagonal Composition Outfit Ideas".
- title_alt: a question or hook, max 100 chars. Example: "What do these looks have in common?"
- description: 1–3 sentences, 100–300 chars. Lead with what is visible, name concrete garments, colours and the composition device; end with a question or a save prompt.
- Do not invent anything that is not in the image or the data: brands, show seasons, names.`,
};

// Пин-загадка «Найди лишнее»: описание зовёт угадать и не выдаёт ответ
function puzzleBlock(overlay, lang) {
  const pz = overlay?.puzzle;
  if (!pz) return '';
  const odd = pz.odd ? (lang === 'ru' ? ` Правильный ответ — №${pz.odd}; он нужен тебе, чтобы не написать ничего, что противоречит ответу, но в тексте его НЕ называй и не намекай на него.` : ` The correct answer is #${pz.odd}; use it only to avoid contradicting it — do NOT state or hint at it.`) : '';
  return lang === 'ru'
    ? `\n\nЭто пин-загадка «Найди лишнее»: на картинке пронумерованы ${pz.count || 'несколько'} образов, один из них лишний.${odd}\n- title: вопрос-загадка или интрига (можно в духе «Какой образ здесь лишний?», но не дословно повторяй текст на картинке).\n- title_alt: другой вариант вопроса.\n- description: подскажи, по какому признаку искать (композиция, силуэт, эстетика), не раскрывая ответа; позови написать номер в комментариях и проверить себя в игре на сайте.`
    : `\n\nThis is an "odd one out" puzzle pin: ${pz.count || 'several'} looks are numbered, one does not belong.${odd}\n- title: a puzzle question or teaser (in the spirit of "Which look is the odd one out?", but do not copy the on-image text verbatim).\n- title_alt: another phrasing of the question.\n- description: hint at what to look at (composition, silhouette, aesthetic) without revealing the answer; invite people to comment the number and test themselves in the game on the site.`;
}

function strategyBlock(strategy, lang) {
  if (!strategy) return '';
  const keywords = (strategy.top_keywords || []).slice(0, 12).map((k) => k.keyword).filter(Boolean).join(', ');
  const parts = [
    strategy.prompt_injection ? strategy.prompt_injection : null,
    keywords ? (lang === 'ru' ? `Ключевые запросы аудитории (на английском, переведи по смыслу, если пишешь по-русски): ${keywords}` : `High-value keywords from audience data: ${keywords}`) : null,
  ].filter(Boolean);
  if (!parts.length) return '';
  return lang === 'ru'
    ? `\n\nSEO-стратегия по аналитике Pinterest (используй, где ключевые запросы честно подходят к картинке; не вставляй неподходящие):\n${parts.join('\n')}`
    : `\n\nSEO strategy from Pinterest analytics (use keywords only where they honestly fit the image):\n${parts.join('\n')}`;
}

function contextBlock(visual, sources, lang) {
  const ru = lang === 'ru';
  const lines = [];
  if (visual.compositions?.length) lines.push(`${ru ? 'Типы композиции' : 'Composition types'}: ${visual.compositions.join(', ')}`);
  if (visual.note) lines.push(`${ru ? 'Заметка автора' : 'Author note'}: ${visual.note}`);
  const ov = visual.overlay || {};
  if (ov.text) lines.push(`${ru ? 'Текст, написанный на самой картинке' : 'Text printed on the image'}: «${ov.text}»`);
  if (sources.length) {
    lines.push(ru ? 'Это коллаж. Части, о которых есть данные (на картинке их может быть больше):' : 'This is a collage. Parts we have data on (the image may contain more):');
    sources.forEach((s, i) => {
      const bits = [
        s.outfit_title ? (ru ? `образ «${s.outfit_title}»` : `outfit "${s.outfit_title}"`) : null,
        s.origin === 'render' ? (ru ? 'рендер' : 'render') : s.origin === 'sketch' ? (ru ? 'эскиз' : 'sketch') : null,
        s.aesthetics ? `${ru ? 'эстетики' : 'aesthetics'}: ${s.aesthetics}` : null,
        s.compositions?.length ? `${ru ? 'композиция' : 'composition'}: ${s.compositions.join(', ')}` : null,
        s.note || null,
      ].filter(Boolean);
      lines.push(`${i + 1}. ${bits.join('; ') || '—'}`);
    });
  }
  return lines.length ? lines.join('\n') : '—';
}

// Возвращает { title, title_alt, description }. Бросает ошибку с понятным текстом, если модель отказала
async function generateVisualSeo({ visual, sources = [], strategy = null, lang = 'ru' }) {
  const L = lang === 'en' ? 'en' : 'ru';
  const prompt = (L === 'ru'
    ? `Ты SEO-редактор пинов Pinterest для проекта о смыслах в моде. Составь заголовок, запасной заголовок и описание пина для этого изображения.\n\nЧто известно об изображении:\n`
    : `You are a Pinterest pin SEO editor for a project about meaning in fashion. Write a title, an alternative title and a pin description for this image.\n\nWhat we know about the image:\n`)
    + contextBlock(visual, sources, L)
    + `\n\n${RULES[L]}`
    + puzzleBlock(visual.overlay, L)
    + strategyBlock(strategy, L);

  const msg = await client.messages.create(
    {
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      // Короткий текст по картинке: глубокие рассуждения не нужны
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      // Если классификатор безопасности откажет, запрос сам повторится на запасной модели
      fallbacks: 'default',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: visual.image_url } },
          { type: 'text', text: prompt },
        ],
      }],
    },
    { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } },
  );

  if (msg.stop_reason === 'refusal') throw new Error('Модель отказалась размечать это изображение');
  if (msg.stop_reason === 'max_tokens') throw new Error('Ответ модели оборвался, попробуйте ещё раз');
  const textBlock = (msg.content || []).find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Модель вернула пустой ответ');
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error('Модель вернула ответ не в том формате');
  }
  const clip = (s, n) => String(s || '').trim().slice(0, n);
  return { title: clip(parsed.title, 100), title_alt: clip(parsed.title_alt, 100), description: clip(parsed.description, 500) };
}

module.exports = { generateVisualSeo };

const Anthropic = require('@anthropic-ai/sdk');

// Какая доска Pinterest подходит рендеру: решаем по уже сохранённому анализу
// (эстетики, описание модели, заголовок и описание пина) — картинку заново не смотрим
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

const SYSTEM = `Ты раскладываешь изображения моды по доскам Pinterest. Тебе дают список досок аккаунта и разбор изображения: эстетики с оценками уверенности, описание модели, заголовок и описание будущего пина.

Выбери доску, которой изображение подходит больше всего: по теме, настроению, случаю, стилю. Если ни одна доска не подходит заметно лучше прочих, всё равно назови самую близкую, но поставь низкую уверенность.

confidence — 0–100. reason — одна короткая фраза по-русски, почему именно эта доска.`;

function renderSummary(render) {
  const aesthetics = (render.aesthetics?.top || [])
    .map((a) => `${a.name} (${a.score})`)
    .join(', ');
  const model = render.model_appearance
    ? Object.entries(render.model_appearance).map(([k, v]) => `${k}: ${v}`).join(', ')
    : '';
  return [
    render.title ? `Образ: ${render.title}` : null,
    aesthetics ? `Эстетики: ${aesthetics}` : null,
    model ? `Модель: ${model}` : null,
    render.pin_title ? `Заголовок пина: ${render.pin_title}` : null,
    render.pin_description ? `Описание пина: ${render.pin_description}` : null,
  ].filter(Boolean).join('\n');
}

// boards: [{ id, name, description }], renders: [{ id, ... }]
async function suggestBoards(boards, renders) {
  if (!boards.length || !renders.length) return [];

  const boardList = boards
    .map((b) => `- ${b.id} · «${b.name}»${b.description ? `: ${b.description}` : ''}`)
    .join('\n');
  const renderList = renders
    .map((r, i) => `[${i + 1}] id=${r.id}\n${renderSummary(r) || 'разбор отсутствует'}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Доски аккаунта:\n${boardList}\n\nИзображения:\n${renderList}` }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  board_id: { type: 'string', enum: boards.map((b) => String(b.id)) },
                  confidence: { type: 'integer' },
                  reason: { type: 'string' },
                },
                required: ['id', 'board_id', 'confidence', 'reason'],
                additionalProperties: false,
              },
            },
          },
          required: ['results'],
          additionalProperties: false,
        },
      },
    },
  });

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const { results } = JSON.parse(text);
  const byId = Object.fromEntries(boards.map((b) => [String(b.id), b.name]));
  return results
    .filter((r) => renders.some((x) => String(x.id) === String(r.id)))
    .map((r) => ({ ...r, board_name: byId[String(r.board_id)] ?? null }));
}

module.exports = { suggestBoards };

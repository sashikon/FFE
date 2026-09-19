const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 300_000 });

const MODELS = {
  cheap: 'claude-haiku-4-5', // отбор: много коротких оценок
  smart: 'claude-opus-5',    // смысл и текст
};

function textOf(response) {
  if (response.stop_reason === 'refusal') {
    throw new Error(`Model refused: ${response.stop_details?.category ?? 'unknown'}`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Response truncated by max_tokens');
  }
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

async function call({ model, system, user, schema, maxTokens = 16000, cache = false }) {
  const params = {
    model,
    max_tokens: maxTokens,
    // Длинный неизменный system (стайлгайд + образцы) кэшируем: повторные черновики читают его в ~10 раз дешевле
    system: cache ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system,
    messages: [{ role: 'user', content: user }],
  };
  if (schema) params.output_config = { format: { type: 'json_schema', schema } };

  // У Opus 5 — серверный fallback на случай ложного отказа классификатора
  const response = model === MODELS.smart
    ? await anthropic.beta.messages.create({
      ...params,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
    : await anthropic.messages.create(params);

  const text = textOf(response);
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}. Raw: ${text.slice(0, 200)}`);
  }
}

module.exports = { call, MODELS };

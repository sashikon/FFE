const Anthropic = require('@anthropic-ai/sdk');

const AESTHETICS = [
  'Cocktail Party Outfit Ideas',
  'Gala & Formal Dresses',
  'Red Carpet Evening Gowns',
  'Evening Outfit Ideas',
  'Night Out Outfits',
  'Boardroom & Office Fashion',
  'Beach & Resort Outfits',
  'Wedding Guest Dresses',
  'Runway & Couture Looks',
  'Streetwear Fashion',
  'Sporty & Casual Outfits',
  'Party Outfit Ideas',
];

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });

function resizeCloudinaryUrl(url, maxPx = 1568) {
  return url.replace('/upload/', `/upload/c_limit,w_${maxPx},h_${maxPx}/`);
}

async function analyzeAesthetics(imageUrl) {
  const safeUrl = resizeCloudinaryUrl(imageUrl);

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: safeUrl } },
          {
            type: 'text',
            text: `Analyze this fashion outfit image. From the list below pick the top 3 most fitting trend aesthetics and assign a confidence score (0–100) to each.

Aesthetics:
${AESTHETICS.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Return ONLY valid JSON, no markdown:
{"top":[{"name":"...","score":85},{"name":"...","score":62},{"name":"...","score":41}]}`,
          },
        ],
      },
    ],
  });

  const raw = response.content[0].text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const parsed = JSON.parse(raw);
  return { top: parsed.top.slice(0, 3), analyzed_at: new Date().toISOString() };
}

module.exports = { analyzeAesthetics, AESTHETICS };

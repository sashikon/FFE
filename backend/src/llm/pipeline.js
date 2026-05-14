const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db');
const { setGameRows } = require('../cache');
const { SYSTEM_PROMPT, USER_PROMPT, SUPPORTED_LANGS } = require('./prompts');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function resizeCloudinaryUrl(url, maxPx = 1568) {
  // Insert Cloudinary transformation to limit max dimension
  return url.replace('/upload/', `/upload/c_limit,w_${maxPx},h_${maxPx}/`);
}

async function generateForLanguage(imageUrl, outfitId, lang) {
  const safeUrl = resizeCloudinaryUrl(imageUrl);
  // Mark as pending
  await pool.query(
    `INSERT INTO outfit_translations (outfit_id, lang, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (outfit_id, lang) DO UPDATE SET status = 'pending', error_msg = NULL`,
    [outfitId, lang]
  );

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: SYSTEM_PROMPT[lang],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: safeUrl } },
            { type: 'text', text: USER_PROMPT(lang) },
          ],
        },
      ],
    });

    const raw = response.content[0].text.trim();
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.game_rows) || parsed.game_rows.length !== 5) {
      throw new Error('LLM returned invalid game_rows structure');
    }

    await pool.query(
      `UPDATE outfit_translations
       SET game_rows = $1, status = 'ready'
       WHERE outfit_id = $2 AND lang = $3`,
      [JSON.stringify(parsed.game_rows), outfitId, lang]
    );

    await setGameRows(outfitId, lang, parsed.game_rows);

    return parsed.game_rows;
  } catch (err) {
    await pool.query(
      `UPDATE outfit_translations
       SET status = 'error', error_msg = $1
       WHERE outfit_id = $2 AND lang = $3`,
      [err.message, outfitId, lang]
    );
    throw err;
  }
}

async function analyzeOutfit(imageUrl, outfitId) {
  const results = await Promise.allSettled(
    SUPPORTED_LANGS.map((lang) => generateForLanguage(imageUrl, outfitId, lang))
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`LLM failed for lang=${SUPPORTED_LANGS[i]}:`, r.reason);
    }
  });
}

module.exports = { analyzeOutfit };

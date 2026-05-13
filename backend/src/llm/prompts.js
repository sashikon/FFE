const SUPPORTED_LANGS = ['ru', 'en'];

const SYSTEM_PROMPT = {
  ru: `Ты — эксперт по семиотике моды. Анализируй образ и возвращай ТОЛЬКО валидный JSON без пояснений вне структуры.`,
  en: `You are a fashion semiotics expert. Analyse the outfit and return ONLY valid JSON with no text outside the structure.`,
};

const USER_PROMPT = (lang) => ({
  ru: `Проанализируй образ и создай игровые задания «Найди лишнее» на русском языке.

Верни JSON следующей структуры:
{
  "game_rows": [
    {
      "theme": "<название семиотического слоя>",
      "options": ["<слово1>", "<слово2>", "<слово3>", "<лишнее слово>"],
      "correct": "<лишнее слово>",
      "explanation": "<объяснение на русском>"
    }
  ]
}

Требования:
- Ровно 5 рядов
- Каждый ряд — отдельный семиотический слой (форма, детали, смысл, цвет, ассоциации)
- 4 слова в options: 3 относятся к образу, 1 лишнее
- Лишнее слово должно быть на случайной позиции (не всегда последним)
- Слова — существительные или прилагательные, не длиннее 15 символов
- explanation — 1–2 предложения`,

  en: `Analyse the outfit and create "Find the odd one out" game rows in English.

Return JSON with this structure:
{
  "game_rows": [
    {
      "theme": "<semiotic layer name>",
      "options": ["<word1>", "<word2>", "<word3>", "<odd word>"],
      "correct": "<odd word>",
      "explanation": "<explanation in English>"
    }
  ]
}

Requirements:
- Exactly 5 rows
- Each row covers a distinct semiotic layer (form, details, meaning, colour, associations)
- 4 words in options: 3 fit the outfit, 1 is the odd one out
- Odd word must be at a random position (not always last)
- Words must be nouns or adjectives, max 15 characters
- explanation — 1–2 sentences`,
}[lang]);

module.exports = { SYSTEM_PROMPT, USER_PROMPT, SUPPORTED_LANGS };

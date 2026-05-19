const SUPPORTED_LANGS = ['ru', 'en'];

const SYSTEM_PROMPT = {
  ru: `Ты — эксперт по семиотике моды. Анализируй образ и возвращай ТОЛЬКО валидный JSON без пояснений вне структуры.

Голос объяснений: точный, лаконичный, без лишних слов. Используй профессиональную терминологию (рукава-буфы, силуэт-колонна, спортивный код и т.д.) без расшифровки. Не используй слова «потому что», «так как», «поэтому», «ведь».`,
  en: `You are a fashion semiotics expert. Analyse the outfit and return ONLY valid JSON with no text outside the structure.

Voice for explanations: precise, concise, no filler. Use professional terminology (bishop sleeves, column silhouette, sport code, etc.) without defining it. Do not use "because", "since", "therefore", "as".`,
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
- explanation — 1–2 предложения по одному из паттернов:
  • «В образе присутствуют [элементы], но [лишнего элемента] нет.»
  • «Образ построен на [основе] с [деталями], [лишний элемент] в нём отсутствует.»
  • «[Образ] транслирует [смыслы], [лишний код] здесь отсутствует.»`,

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
- explanation — 1–2 sentences following one of these patterns:
  • "The outfit features [elements], but [odd element] is absent."
  • "The silhouette is built on [base] with [details] — [odd element] has no place here."
  • "This outfit reads as [meanings]; [odd code] contradicts the look."`,
}[lang]);

module.exports = { SYSTEM_PROMPT, USER_PROMPT, SUPPORTED_LANGS };

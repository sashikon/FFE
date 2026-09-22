const { pool } = require('./db');
const { call, MODELS } = require('./llm');

// Память правок: из комментария автора к правке извлекаем общее правило
// и подмешиваем все активные правила в промпты написания и литредактуры
const MAX_RULES = 25;

async function activeRules() {
  const { rows } = await pool.query('SELECT id, rule FROM editor_rules WHERE active ORDER BY id');
  return rows;
}

const LEARN_SYSTEM = `Ты ведёшь «уроки редактора» — список правил, по которым пишутся посты авторского Telegram-канала о смыслах в моде. Автор канала прокомментировала правку одного поста. Реши, есть ли в комментарии ОБЩЕЕ правило, полезное для будущих постов.

Общее правило — про голос, язык, структуру, длину, подачу теории, отношение к читателю, лексику: «Не начинай пост с цифры», «Бодрийяра — не чаще раза в неделю», «Вопрос читателю — одной фразой».
Не общее — правка конкретного поста: «убери второй абзац», «замени пример с Gucci», «поправь дату». Для таких action = "none".

Если правило уже есть в списке — action = "none". Если новое уточняет, расширяет или противоречит существующим — action = "update": сформулируй одно объединённое правило и перечисли id заменяемых в replaces.
Формулировка — одно короткое повелительное предложение по-русски, без ссылок на конкретный пост.`;

const LEARN_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['none', 'add', 'update'] },
    rule: { type: 'string' },
    replaces: { type: 'array', items: { type: 'integer' } },
  },
  required: ['action', 'rule', 'replaces'],
  additionalProperties: false,
};

async function compressRules() {
  const rules = await activeRules();
  if (rules.length <= MAX_RULES) return;
  const { rules: merged } = await call({
    model: MODELS.smart,
    system: `Сожми список правил редактора до ${MAX_RULES} или меньше: объедини близкие и повторяющиеся, противоречия реши в пользу более позднего (больший номер). Каждое правило — одно короткое повелительное предложение по-русски.`,
    user: rules.map((r) => `${r.id}. ${r.rule}`).join('\n'),
    schema: {
      type: 'object',
      properties: { rules: { type: 'array', items: { type: 'string' } } },
      required: ['rules'],
      additionalProperties: false,
    },
  });
  await pool.query('UPDATE editor_rules SET active = FALSE WHERE active');
  for (const rule of merged.slice(0, MAX_RULES)) {
    await pool.query('INSERT INTO editor_rules (rule) VALUES ($1)', [rule]);
  }
}

// Возвращает { id, rule } запомненного правила или null
async function learnFromFeedback(postId, previousText, feedback) {
  const rules = await activeRules();
  const res = await call({
    model: MODELS.smart,
    system: LEARN_SYSTEM,
    user: `Текущие правила:\n${rules.length ? rules.map((r) => `${r.id}. ${r.rule}`).join('\n') : '(пока нет)'}\n\nПост до правки:\n${previousText}\n\nКомментарий автора: ${feedback}`,
    schema: LEARN_SCHEMA,
    maxTokens: 2000,
  });
  if (res.action === 'none' || !res.rule.trim()) return null;

  if (res.action === 'update') {
    const ids = res.replaces.filter((id) => rules.some((r) => r.id === id));
    if (ids.length) await pool.query('UPDATE editor_rules SET active = FALSE WHERE id = ANY($1)', [ids]);
  }
  const { rows: [row] } = await pool.query(
    'INSERT INTO editor_rules (rule, source_post_id) VALUES ($1, $2) RETURNING id', [res.rule.trim(), postId]
  );
  await compressRules();
  console.log(`[learn] ${res.action}: ${res.rule}`);
  // после сжатия правило могло слиться с другими — тогда кнопку «не запоминать» не даём
  const { rows: [still] } = await pool.query('SELECT id FROM editor_rules WHERE id = $1 AND active', [row.id]);
  return { id: still?.id ?? null, rule: res.rule.trim() };
}

// Насколько правка велика: сумма длин слов, которые появились или исчезли
function changedChars(before, after) {
  const words = (t) => t.replace(/<[^>]+>/g, ' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const count = (list) => list.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const a = count(words(before));
  const b = count(words(after));
  let changed = 0;
  for (const [w, n] of a) changed += Math.max(0, n - (b.get(w) || 0)) * w.length;
  for (const [w, n] of b) changed += Math.max(0, n - (a.get(w) || 0)) * w.length;
  return changed;
}

// Размер правки — плохой фильтр: убранная антитеза или сокращённый финал невелики, но это правила.
// Поэтому отсекаем только совсем мелкое (опечатка в одном слове), а решает модель.
const MIN_EDIT = 12;

const LEARN_EDIT_SYSTEM = `Ты ведёшь «уроки редактора» — список правил, по которым пишутся посты авторского Telegram-канала о смыслах в моде. Автор вручную отредактировала пост. Сравни версии «до» и «после» и реши, есть ли в правке ОБЩЕЕ правило, полезное для будущих постов.

Общее правило — про голос, язык, структуру, длину, подачу теории, отношение к читателю, лексику: «Не используй слово „буквально“», «Финал — одна фраза», «Имена теоретиков — не больше одного на пост».
Правила нет, если правка касается только этого поста: исправлена опечатка или факт, заменён конкретный пример, сокращён один абзац по смыслу, переставлены части именно этого текста. В таком случае action = "none". Это самый частый ответ — не выдумывай правило там, где его нет.

Если правило уже есть в списке — action = "none". Если новое уточняет или расширяет существующее — action = "update" с объединённой формулировкой и id заменяемых в replaces.
Формулировка — одно короткое повелительное предложение по-русски, без ссылок на конкретный пост.`;

// Из ручной правки в админке: возвращает { id, rule } или null
async function learnFromEdit(postId, before, after) {
  if (changedChars(before, after) < MIN_EDIT) return null;
  const rules = await activeRules();
  const res = await call({
    model: MODELS.smart,
    system: LEARN_EDIT_SYSTEM,
    user: `Текущие правила:\n${rules.length ? rules.map((r) => `${r.id}. ${r.rule}`).join('\n') : '(пока нет)'}\n\nБЫЛО:\n${before}\n\nСТАЛО:\n${after}`,
    schema: LEARN_SCHEMA,
    maxTokens: 2000,
  });
  if (res.action === 'none' || !res.rule.trim()) return null;

  if (res.action === 'update') {
    const ids = res.replaces.filter((id) => rules.some((r) => r.id === id));
    if (ids.length) await pool.query('UPDATE editor_rules SET active = FALSE WHERE id = ANY($1)', [ids]);
  }
  const { rows: [row] } = await pool.query(
    'INSERT INTO editor_rules (rule, source_post_id) VALUES ($1, $2) RETURNING id', [res.rule.trim(), postId]
  );
  await compressRules();
  console.log(`[learn] из правки ${res.action}: ${res.rule}`);
  const { rows: [still] } = await pool.query('SELECT id FROM editor_rules WHERE id = $1 AND active', [row.id]);
  return { id: still?.id ?? null, rule: res.rule.trim() };
}

async function addRule(rule) {
  await pool.query('INSERT INTO editor_rules (rule) VALUES ($1)', [rule]);
  await compressRules();
}

async function removeRule(id) {
  const { rowCount } = await pool.query('UPDATE editor_rules SET active = FALSE WHERE id = $1 AND active', [id]);
  return rowCount > 0;
}

module.exports = { activeRules, learnFromFeedback, learnFromEdit, addRule, removeRule, changedChars };

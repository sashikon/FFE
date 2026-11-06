// Схема структурированного ответа принимает не любой JSON Schema: ограничения
// длины и числовые отвергаются с 400 — «For 'array' type, property 'maxItems'
// is not supported». Поймать это можно только живым запросом, а он стоит денег
// и ключа, поэтому проверяем схемы на месте.
//
// Список взят из документации структурированного вывода: поддерживаются типы,
// enum, const, anyOf, allOf, $ref/$defs, строковые форматы и additionalProperties: false.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN = ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'minProperties', 'maxProperties', 'uniqueItems', 'pattern'];

function findForbidden(node, at, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => findForbidden(v, `${at}[${i}]`, out));
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN.includes(key)) out.push(`${at}.${key}`);
    findForbidden(value, `${at}.${key}`, out);
  }
  return out;
}

test('в схемах prompts.js нет ограничений, которых не принимает структурированный вывод', () => {
  const P = require('../src/prompts.js');
  const found = [];
  for (const [name, value] of Object.entries(P)) {
    if (/SCHEMA$/.test(name)) found.push(...findForbidden(value, name));
  }
  assert.deepEqual(found, [], `отвергнутые ограничения: ${found.join(', ')}`);
});

// Схемы бывают и прямо в вызове call({ schema: … }) — их обходом объекта не достать
test('в схемах, написанных прямо в коде, их тоже нет', () => {
  const dir = path.join(__dirname, '..', 'src');
  const hits = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const word of FORBIDDEN) {
      // только как ключ объекта: «maxItems:» — иначе попадут слова из комментариев
      const re = new RegExp(`(^|[\\s{,])${word}\\s*:`, 'm');
      if (re.test(src)) hits.push(`${file}: ${word}`);
    }
  }
  assert.deepEqual(hits, [], `отвергнутые ограничения: ${hits.join(', ')}`);
});

// Объекты в схеме обязаны запрещать лишние поля, иначе API отвечает 400
test('у каждого объекта в схемах стоит additionalProperties: false', () => {
  const P = require('../src/prompts.js');
  const bare = [];
  const walk = (node, at) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${at}[${i}]`));
    if (node.type === 'object' && node.additionalProperties !== false) bare.push(at);
    for (const [key, value] of Object.entries(node)) walk(value, `${at}.${key}`);
  };
  for (const [name, value] of Object.entries(P)) if (/SCHEMA$/.test(name)) walk(value, name);
  assert.deepEqual(bare, [], `без additionalProperties: false — ${bare.join(', ')}`);
});

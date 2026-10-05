// Читает channel/src/api.js и выписывает, какие адреса есть у API канала
// и какие параметры читает каждый: из строки запроса и из тела.
// Разбор текстовый: роутер там — цепочка if по url.pathname, и этого хватает.
import { readFileSync } from 'node:fs';

// Адреса, к которым админка ходить не должна: их прокси и не нужен
export const NOT_PROXIED = {
  '/health': 'проверка живости для Railway',
  '/api/pinterest/callback': 'сюда возвращает браузер после входа в Pinterest',
};

export function parseChannelApi(file) {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('function startApi(');
  if (start < 0) throw new Error(`не нашёл startApi в ${file}`);
  const router = src.slice(start);

  // имя переменной с match → регулярка: const write = url.pathname.match(/^...$/)
  const matchers = {};
  for (const m of router.matchAll(/const (\w+) = url\.pathname\.match\(\/(.+?)\/\);/g)) matchers[m[1]] = m[2];

  const routes = [];
  let current = null;
  for (const line of router.split('\n')) {
    const method = line.match(/req\.method === '(\w+)'/)?.[1];
    const exact = line.match(/url\.pathname === '([^']+)'/)?.[1];
    const byMatch = method && Object.keys(matchers).find((name) => new RegExp(`&& ${name}\\)`).test(line));
    if (method && (exact || byMatch)) {
      current = {
        method,
        path: exact || null,
        pattern: byMatch ? matchers[byMatch] : null,
        query: new Set(),
        body: new Set(),
        text: '',
      };
      routes.push(current);
    }
    if (current) current.text += `${line}\n`;
  }

  for (const r of routes) {
    for (const m of r.text.matchAll(/searchParams\.get\('(\w+)'\)/g)) r.query.add(m[1]);
    addBodyKeys(r.body, r.text);
    // тело может разбирать вызванная функция этого файла (handleWrite)
    for (const [, fn] of r.text.matchAll(/await (\w+)\(req\b/g)) {
      const def = src.match(new RegExp(`async function ${fn}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`));
      if (def) addBodyKeys(r.body, def[1]);
    }
    r.label = r.path || `/${r.pattern.replace(/^\^\\\//, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\(\\d\+\)/g, ':id')}`;
    r.query = [...r.query];
    r.body = [...r.body];
    delete r.text;
  }
  return routes;
}

function addBodyKeys(set, text) {
  if (!/readJson\(req/.test(text)) return;
  for (const m of text.matchAll(/\bbody\.(\w+)/g)) set.add(m[1]);
  for (const m of text.matchAll(/const \{([^}]+)\} = await readJson\(req/g)) {
    for (const part of m[1].split(',')) set.add(part.trim().split(/[\s=:]/)[0]);
  }
}

export function routeFor(routes, method, pathname) {
  return routes.find((r) => r.method === method && (r.path ? r.path === pathname : new RegExp(r.pattern).test(pathname)));
}

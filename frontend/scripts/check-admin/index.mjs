// Проверка админки до деплоя: npm run check:admin (после npm run build).
//
// 1. Прокси. Вызывает каждый frontend/pages/api/channel-* со всеми параметрами,
//    которые читает channel/src/api.js, и смотрит, что дошло до сервиса канала.
//    Так ловится «фильтр молча не работает, потому что прокси не передал category».
// 2. Страницы. Поднимает собранную админку (next start), входит подставной сессией
//    и открывает каждую страницу /admin/* в браузере на подставных данных, нажимая вкладки.
//    Ловит то, чего не видит next build: ошибку при отрисовке (так падала
//    /admin/channel — переменная без объявления), ответы 4xx/5xx, ошибки в консоли.
//
// Ни ключей, ни базы, ни сети не нужно: сервис канала и бэкенд подменены.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from 'next-auth/jwt';
import { chromium } from 'playwright-core';
import { parseChannelApi, routeFor, NOT_PROXIED } from './channel-api.mjs';
import * as fixtures from './fixtures.mjs';

const FRONTEND = fileURLToPath(new URL('../../', import.meta.url));
const CHANNEL_API = fileURLToPath(new URL('../../../channel/src/api.js', import.meta.url));
const SECRET = 'check-admin-secret';
const CHANNEL_TOKEN = 'check-admin-channel-token';

// Что кликнуть на странице после загрузки: вкладки рисуются по клику,
// и ошибка в невидимой вкладке иначе осталась бы незамеченной.
// Новая страница без записи здесь тоже проверится — просто без кликов.
const CLICKS = {
  '/admin': ['Renders', 'Coverage', 'Mechanics', 'SEO', 'Outfits'],
  '/admin/channel': ['Не утверждено', 'В очереди', 'Календарь', 'Опубликовано', 'Отложено', 'Все'],
  '/admin/trends': ['Топ недели', 'Угасают', 'Соцсети', 'Растут'],
};

// Значения параметров, которые прокси проверяет по списку: подставляем допустимые
const QUERY_VALUES = { status: 'draft', days: '7', refresh: '1' };
// Значения динамических частей пути: [op] берётся из списка допустимых действий
const SEGMENT_VALUES = { op: 'action', idx: '0' };

const problems = [];
const fail = (where, what) => problems.push({ where, what });

// ─── подставной сервис канала ────────────────────────────────────────────────

function startChannelMock() {
  const seen = [];
  const keys = Object.keys(fixtures.channel).map((key) => {
    const [method, path] = key.includes(' ') ? key.split(' ') : ['GET', key];
    return { key, method, re: new RegExp(`^${path.replace(/:\w+/g, '[^/]+')}$`) };
  });
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, token: req.headers['x-channel-token'] });

      if (req.headers['x-channel-token'] !== CHANNEL_TOKEN) return json(res, 401, { error: 'Unauthorized' });
      if (/^\/api\/social\/\d+\/frame\/\d+$/.test(url.pathname)) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(Buffer.alloc(0));
      }
      const hit = keys.find((k) => k.method === req.method && k.re.test(url.pathname));
      if (!hit) return json(res, 404, { error: `нет подставного ответа для ${req.method} ${url.pathname}` });
      return json(res, 200, fixtures.channel[hit.key](url));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// ─── админка ────────────────────────────────────────────────────────────────

async function startNext(channelPort) {
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
    NEXTAUTH_SECRET: SECRET,
    CHANNEL_API_URL: `http://127.0.0.1:${channelPort}`,
    CHANNEL_API_TOKEN: CHANNEL_TOKEN,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const child = spawn(process.execPath, [join(FRONTEND, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: FRONTEND, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`next start завершился:\n${log.join('')}`);
    try {
      await fetch(`${base}/admin/login`);
      return { child, base, log };
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  child.kill();
  throw new Error(`next start не поднялся за 20 секунд:\n${log.join('')}`);
}

function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Сессия next-auth без GitHub: тот же зашифрованный cookie, что выдаёт вход
async function sessionCookie() {
  const value = await encode({ token: { name: 'check-admin', login: 'check-admin', sub: '1' }, secret: SECRET });
  return { name: 'next-auth.session-token', value };
}

// ─── 1. прокси ──────────────────────────────────────────────────────────────

function listProxies() {
  const dir = join(FRONTEND, 'pages/api');
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.js$/.test(name)) out.push(p);
    }
  };
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.startsWith('channel-')) statSync(p).isDirectory() ? walk(p) : out.push(p);
  }
  return out.sort();
}

async function checkProxies({ base, cookie, mock, routes }) {
  const allQuery = [...new Set(routes.flatMap((r) => r.query))];
  const allBody = [...new Set(routes.flatMap((r) => r.body))];
  const reached = new Set();

  for (const file of listProxies()) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(join(FRONTEND, 'pages'), file).replace(/\\/g, '/');
    const urlPath = `/${rel.replace(/\.js$/, '').replace(/\/index$/, '')}`
      .replace(/\[(\w+)\]/g, (_, name) => SEGMENT_VALUES[name] || '1');
    const method = /req\.method !== 'POST'/.test(src) ? 'POST' : 'GET';

    // все параметры, какие читает API канала, с узнаваемыми значениями
    const qs = new URLSearchParams({ id: '1' });
    for (const name of allQuery) qs.set(name, QUERY_VALUES[name] || `v-${name}`);
    const body = Object.fromEntries(allBody.map((name) => [name, `v-${name}`]));

    const before = mock.seen.length;
    const problemsBefore = problems.length;
    const res = await fetch(`${base}${urlPath}?${qs}`, {
      method,
      headers: { cookie: `${cookie.name}=${cookie.value}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    });
    const calls = mock.seen.slice(before);
    const where = `pages/${rel}`;
    if (res.status >= 500) fail(where, `${method} ${urlPath} ответил ${res.status}`);
    if (!calls.length) { fail(where, `${method} ${urlPath} не дошёл до сервиса канала (ответ ${res.status})`); continue; }

    for (const call of calls) {
      if (call.token !== CHANNEL_TOKEN) fail(where, 'не передал x-channel-token');
      const route = routeFor(routes, call.method, call.path);
      if (!route) { fail(where, `ходит на ${call.method} ${call.path}, а такого адреса в channel/src/api.js нет`); continue; }
      reached.add(route);
      for (const name of route.query) {
        if (!(name in call.query)) fail(where, `не передаёт параметр «${name}» в ${call.method} ${route.label} — API канала его читает, а до него он не доходит`);
      }
      for (const name of route.body) {
        if (!call.body || typeof call.body !== 'object' || !(name in call.body)) fail(where, `не передаёт поле «${name}» в теле ${call.method} ${route.label}`);
      }
    }
    console.log(`  ${problems.length > problemsBefore ? '✗' : '✓'} ${where} → ${calls.map((c) => `${c.method} ${c.path}`).join(', ')}`);
  }

  // адрес API канала, до которого не ведёт ни один прокси: админка его не видит
  for (const r of routes) {
    if (reached.has(r) || NOT_PROXIED[r.label]) continue;
    fail('channel/src/api.js', `к ${r.method} ${r.label} не ведёт ни один прокси frontend/pages/api/channel-*`);
  }
}

// ─── 2. страницы ────────────────────────────────────────────────────────────

function listAdminPages() {
  return readdirSync(join(FRONTEND, 'pages/admin'))
    .filter((n) => /\.(jsx?|tsx?)$/.test(n) && !n.startsWith('_'))
    .map((n) => `/admin/${n.replace(/\.\w+$/, '')}`.replace(/\/index$/, ''))
    .sort();
}

async function checkPages({ base, cookie }) {
  const browser = await chromium.launch().catch((e) => {
    throw new Error(`Не запустился браузер. На своём компьютере поставьте его один раз: npx playwright-core install chromium\n${e.message.split('\n')[0]}`);
  });
  try {
    for (const path of listAdminPages()) {
      const loggedIn = path !== '/admin/login';
      const context = await browser.newContext();
      if (loggedIn) await context.addCookies([{ ...cookie, url: base }]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`ошибка на странице: ${e.message}`));
      // «Failed to load resource» без адреса дублирует ответы ниже — их пишем с адресом
      page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`консоль: ${m.text().split('\n')[0]}`); });
      page.on('response', (r) => {
        const url = new URL(r.url());
        if (url.origin === base && r.status() >= 400) errors.push(`${r.status()} от ${url.pathname}${url.search}`);
      });

      // во внешний мир не ходим: картинки Cloudinary, аналитика — не то, что проверяем
      await page.route((url) => url.origin !== base, (route) => route.abort());
      // аналитика Vercel есть только на Vercel
      await page.route((url) => url.pathname.startsWith('/_vercel/'), (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));

      // бэкенд игры: страница зовёт его из браузера, отвечаем подставными данными
      await page.route((url) => url.pathname.startsWith('/api/admin/'), (route) => {
        const url = new URL(route.request().url());
        const key = `${route.request().method()} ${url.pathname}`;
        const fx = fixtures.backend[key] || fixtures.backend[url.pathname];
        return fx
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx(url)) })
          : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `нет подставного ответа для ${key}` }) });
      });

      const res = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      const landed = new URL(page.url()).pathname;
      if (res.status() >= 400 || (loggedIn && landed !== path)) {
        // дальше смотреть нечего: страница не открылась
        fail(path, landed !== path
          ? `вместо страницы перекинуло на ${landed} — подставная сессия не принята`
          : `страница ответила ${res.status()} — упала при отрисовке на сервере (подробности: next start в выводе выше)`);
        console.log(`  ✗ ${path}`);
        await context.close();
        continue;
      }
      for (const label of CLICKS[path] || []) {
        // на вкладке может стоять значок и счётчик: «📈 Растут · 3»
        const button = page.getByRole('button', { name: new RegExp(`^(\\S+ )?${label}( · \\d+)?$`) });
        if (!(await button.count())) { fail(path, `не нашёл кнопку «${label}» (список кликов — CLICKS в scripts/check-admin/index.mjs)`); continue; }
        try {
          await button.first().click({ timeout: 5000 });
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(300); // данные пришли — даём React отрисовать их
        } catch (e) {
          errors.push(`не получилось нажать «${label}»: ${e.message.split('\n')[0]}`);
        }
        // после ошибки страница обычно уже не та — остальные вкладки не нажать
        if (errors.length) { errors.unshift(`ошибка после нажатия «${label}»:`); break; }
      }
      // next показывает это вместо страницы, если отрисовка упала в браузере
      if (await page.getByText('Application error: a client-side exception has occurred').count()) {
        errors.push('страница не отрисовалась (Application error)');
      }
      // CHECK_ADMIN_SCREENSHOTS=папка — сохранить, что видела проверка
      if (process.env.CHECK_ADMIN_SCREENSHOTS) {
        const name = path.replace(/^\//, '').replace(/\//g, '-') || 'admin';
        await page.screenshot({ path: join(process.env.CHECK_ADMIN_SCREENSHOTS, `${name}.png`), fullPage: true });
      }
      for (const e of [...new Set(errors)]) fail(path, e);
      console.log(`  ${errors.length ? '✗' : '✓'} ${path}${CLICKS[path] ? ` (+ вкладки: ${CLICKS[path].length})` : ''}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// ─── запуск ─────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(join(FRONTEND, '.next/BUILD_ID'))) {
    console.error('Нет сборки. Сначала: npm --prefix frontend run build');
    process.exit(2);
  }
  const routes = parseChannelApi(CHANNEL_API);
  const mock = await startChannelMock();
  const next = await startNext(mock.port);
  const cookie = await sessionCookie();
  try {
    console.log('Прокси к API канала:');
    await checkProxies({ base: next.base, cookie, mock, routes });
    console.log('Страницы админки:');
    await checkPages({ base: next.base, cookie });
  } finally {
    const serverErrors = next.log.join('').split('\n').filter((l) => /error/i.test(l));
    if (problems.length && serverErrors.length) console.error(`\nnext start:\n${serverErrors.slice(0, 20).join('\n')}`);
    next.child.kill();
    mock.server.close();
  }

  if (problems.length) {
    console.error(`\nНайдено проблем: ${problems.length}`);
    for (const p of problems) console.error(`  ✗ ${p.where}: ${p.what}`);
    process.exit(1);
  }
  console.log('\nВсё в порядке.');
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

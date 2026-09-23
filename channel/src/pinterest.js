// Доступ к Pinterest по OAuth: маркер из панели разработчика живёт 30 дней,
// а выданный по коду обновляется сам — пока жив refresh-маркер (60 дней,
// и каждое обновление продлевает его заново).
const crypto = require('crypto');
const { getState, setState } = require('./db');

const APP_ID = (process.env.PINTEREST_APP_ID || '').trim();
const APP_SECRET = (process.env.PINTEREST_APP_SECRET || '').trim();
const REDIRECT_URI = (process.env.PINTEREST_REDIRECT_URI || '').trim();
const SCOPE = 'user_accounts:read';
const STATE_KEY = 'pinterest_oauth_state';
const TOKENS_KEY = 'pinterest_oauth';
// обновляем заранее: на границе срока запрос уже может не успеть
const RENEW_BEFORE_MS = 2 * 24 * 3600 * 1000;
const STATE_TTL_MS = 15 * 60 * 1000;

const configured = () => Boolean(APP_ID && APP_SECRET && REDIRECT_URI);

function missingSettings() {
  const missing = [
    !APP_ID && 'PINTEREST_APP_ID',
    !APP_SECRET && 'PINTEREST_APP_SECRET',
    !REDIRECT_URI && 'PINTEREST_REDIRECT_URI',
  ].filter(Boolean);
  return missing;
}

async function tokenRequest(body) {
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    // continuous_refresh нужен приложениям старше 25 сентября 2025; новым он не мешает
    body: new URLSearchParams({ ...body, continuous_refresh: 'true' }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // сообщение Pinterest бывает информативным, но маркеры в него попасть не должны
    const why = String(data.message || data.error_description || data.error || `HTTP ${res.status}`).slice(0, 200);
    throw new Error(why);
  }
  return data;
}

async function saveTokens(data, previous = {}) {
  const now = Date.now();
  const tokens = {
    access_token: data.access_token,
    expires_at: new Date(now + (data.expires_in || 0) * 1000).toISOString(),
    // при обновлении Pinterest может не прислать новый refresh — тогда живём со старым
    refresh_token: data.refresh_token || previous.refresh_token || null,
    refresh_expires_at: data.refresh_token_expires_in
      ? new Date(now + data.refresh_token_expires_in * 1000).toISOString()
      : previous.refresh_expires_at || null,
    scope: data.scope || previous.scope || SCOPE,
    updated_at: new Date(now).toISOString(),
  };
  await setState(TOKENS_KEY, tokens);
  return tokens;
}

// Ссылка, по которой владелец один раз разрешает доступ. state защищает от того,
// чтобы по нашему адресу возврата подсунули чужой код
async function authUrl() {
  if (!configured()) throw new Error(`не заданы переменные: ${missingSettings().join(', ')}`);
  const state = crypto.randomBytes(16).toString('hex');
  await setState(STATE_KEY, { state, at: new Date().toISOString() });
  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `https://www.pinterest.com/oauth/?${params}`;
}

async function exchangeCode(code, state) {
  const saved = await getState(STATE_KEY);
  if (!saved?.state || saved.state !== state) throw new Error('не совпал одноразовый код ссылки — начните заново командой /pinterest');
  if (Date.now() - new Date(saved.at).getTime() > STATE_TTL_MS) throw new Error('ссылка просрочена — начните заново командой /pinterest');
  await setState(STATE_KEY, null);
  const data = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  return saveTokens(data);
}

async function refresh() {
  const tokens = await getState(TOKENS_KEY);
  if (!tokens?.refresh_token) throw new Error('нет refresh-маркера — нужно разрешить доступ заново, команда /pinterest');
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  return saveTokens(data, tokens);
}

// Маркер для запроса: выданный по OAuth (с обновлением) или, если OAuth не настроен,
// тот, что вручную положен в переменную
async function accessToken({ force = false } = {}) {
  const tokens = await getState(TOKENS_KEY);
  if (tokens?.access_token) {
    const expiresIn = new Date(tokens.expires_at).getTime() - Date.now();
    if (!force && expiresIn > RENEW_BEFORE_MS) return tokens.access_token;
    const renewed = await refresh();
    return renewed.access_token;
  }
  const manual = (process.env.PINTEREST_ACCESS_TOKEN || '').trim();
  if (manual) return manual;
  return null;
}

// Что показать человеку: откуда берётся доступ и до какого числа он живёт
async function tokenInfo() {
  const tokens = await getState(TOKENS_KEY);
  if (tokens?.access_token) {
    return {
      source: 'oauth',
      expiresAt: tokens.expires_at,
      refreshExpiresAt: tokens.refresh_expires_at,
      updatedAt: tokens.updated_at,
    };
  }
  if ((process.env.PINTEREST_ACCESS_TOKEN || '').trim()) return { source: 'manual' };
  return { source: null, missing: missingSettings() };
}

module.exports = { configured, missingSettings, authUrl, exchangeCode, refresh, accessToken, tokenInfo, REDIRECT_URI };

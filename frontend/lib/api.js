const BASE = process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || '';

const adminHeaders = () =>
  ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {};

export const fetcher = (url) =>
  fetch(`${BASE}${url}`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

export const adminFetcher = (url) =>
  fetch(`${BASE}${url}`, { headers: adminHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

export const apiPost = (url, body) => {
  const isForm = body instanceof FormData;
  return fetch(`${BASE}${url}`, {
    method: 'POST',
    body: isForm ? body : JSON.stringify(body),
    headers: {
      ...adminHeaders(),
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
};

export const apiPatch = (url, body) =>
  fetch(`${BASE}${url}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
  }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

export const apiDelete = (url) =>
  fetch(`${BASE}${url}`, { method: 'DELETE', headers: adminHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

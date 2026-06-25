const AD_ACCOUNT_ID = process.env.PINTEREST_AD_ACCOUNT_ID;
const ACCESS_TOKEN  = process.env.PINTEREST_ACCESS_TOKEN;
const READ_TOKEN    = process.env.PINTEREST_READ_TOKEN || process.env.PINTEREST_ACCESS_TOKEN;
const BASE          = 'https://api.pinterest.com/v5';

function pinterestHeaders(token) {
  return { 'Authorization': `Bearer ${token || ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
}

async function pinterestGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: pinterestHeaders(READ_TOKEN) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinterest API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Send one or more events to Pinterest Conversions API.
 */
async function sendPinterestEvents(events) {
  if (!AD_ACCOUNT_ID || !ACCESS_TOKEN) return { skipped: true };

  const payload = {
    data: events.map((e) => ({
      event_name:       e.event_name,
      action_source:    'web',
      event_time:       Math.floor(Date.now() / 1000),
      event_id:         e.event_id || crypto.randomUUID(),
      event_source_url: e.event_source_url,
      ...(e.user_data   ? { user_data: e.user_data }     : {}),
      ...(e.custom_data ? { custom_data: e.custom_data } : {}),
    })),
  };

  const res = await fetch(`${BASE}/ad_accounts/${AD_ACCOUNT_ID}/events`, {
    method: 'POST',
    headers: pinterestHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinterest API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Fetch all pins from user's account (paginated).
 * Returns array of { id, link, media.images }.
 */
async function fetchAllPins() {
  const pins = [];
  let bookmark = null;

  do {
    const qs = bookmark ? `?bookmark=${encodeURIComponent(bookmark)}&page_size=100` : '?page_size=100';
    const data = await pinterestGet(`/pins${qs}`);
    if (Array.isArray(data.items)) pins.push(...data.items);
    bookmark = data.bookmark || null;
  } while (bookmark);

  return pins;
}

/**
 * Fetch analytics for a single pin.
 * Returns { impressions, pin_clicks, outbound_clicks, saves } or null.
 */
async function fetchPinAnalytics(pinId) {
  const end   = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const metrics = 'IMPRESSION,PIN_CLICK,OUTBOUND_CLICK,SAVE';

  try {
    const data = await pinterestGet(
      `/pins/${pinId}/analytics?start_date=${start}&end_date=${end}&metric_types=${metrics}`
    );
    // Sum daily values
    const totals = { impressions: 0, pin_clicks: 0, outbound_clicks: 0, saves: 0 };
    for (const daily of (data.all?.daily_metrics || [])) {
      totals.impressions     += daily.data_status === 'READY' ? (daily.IMPRESSION      || 0) : 0;
      totals.pin_clicks      += daily.data_status === 'READY' ? (daily.PIN_CLICK       || 0) : 0;
      totals.outbound_clicks += daily.data_status === 'READY' ? (daily.OUTBOUND_CLICK  || 0) : 0;
      totals.saves           += daily.data_status === 'READY' ? (daily.SAVE            || 0) : 0;
    }
    return totals;
  } catch {
    return null;
  }
}

module.exports = { sendPinterestEvents, fetchAllPins, fetchPinAnalytics };

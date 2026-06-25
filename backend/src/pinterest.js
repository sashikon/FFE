const AD_ACCOUNT_ID = process.env.PINTEREST_AD_ACCOUNT_ID;
const ACCESS_TOKEN  = process.env.PINTEREST_ACCESS_TOKEN;
const API_URL       = `https://api.pinterest.com/v5/ad_accounts/${AD_ACCOUNT_ID}/events`;

/**
 * Send one or more events to Pinterest Conversions API.
 * Each event: { event_name, event_source_url, event_id?, user_data? }
 */
async function sendPinterestEvents(events) {
  if (!AD_ACCOUNT_ID || !ACCESS_TOKEN) return { skipped: true };

  const payload = {
    data: events.map((e) => ({
      event_name:        e.event_name,
      action_source:     'web',
      event_time:        Math.floor(Date.now() / 1000),
      event_id:          e.event_id || crypto.randomUUID(),
      event_source_url:  e.event_source_url,
      ...(e.user_data ? { user_data: e.user_data } : {}),
      ...(e.custom_data ? { custom_data: e.custom_data } : {}),
    })),
  };

  const res = await fetch(API_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinterest API ${res.status}: ${text}`);
  }

  return res.json();
}

module.exports = { sendPinterestEvents };

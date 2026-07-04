const BASE = process.env.NEXT_PUBLIC_API_URL || '';

export function sendPinterestEvent(eventName, sourceUrl, customData) {
  const eventId = typeof crypto !== 'undefined' ? crypto.randomUUID() : undefined;
  fetch(`${BASE}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_name: eventName,
      event_source_url: sourceUrl,
      event_id: eventId,
      ...(customData ? { custom_data: customData } : {}),
    }),
  }).catch(() => {}); // fire-and-forget, never breaks UX
}

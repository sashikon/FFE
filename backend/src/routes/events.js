const express = require('express');
const { sendPinterestEvents } = require('../pinterest');

const router = express.Router();

const ALLOWED_EVENTS = new Set(['page_visit', 'view_content', 'game_complete']);

// POST /api/events
// Body: { event_name, event_source_url, event_id?, custom_data? }
// Called client-side; IP + user-agent forwarded for Pinterest user_data.
router.post('/events', async (req, res) => {
  try {
    const { event_name, event_source_url, event_id, custom_data } = req.body;

    if (!event_name || !ALLOWED_EVENTS.has(event_name)) {
      return res.status(400).json({ error: 'Invalid event_name' });
    }
    if (!event_source_url) {
      return res.status(400).json({ error: 'event_source_url required' });
    }

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const ua = req.headers['user-agent'] || '';

    await sendPinterestEvents([{
      event_name,
      event_source_url,
      event_id,
      custom_data,
      user_data: {
        ...(ip ? { client_ip_address: ip } : {}),
        ...(ua ? { client_user_agent: ua } : {}),
      },
    }]);

    res.json({ ok: true });
  } catch (err) {
    // Non-fatal — log but don't break the app
    console.error('[pinterest events]', err.message);
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;

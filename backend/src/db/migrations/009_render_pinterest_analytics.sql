ALTER TABLE outfit_renders ADD COLUMN IF NOT EXISTS pinterest_pin_id TEXT;
ALTER TABLE outfit_renders ADD COLUMN IF NOT EXISTS pinterest_analytics JSONB;
ALTER TABLE outfit_renders ADD COLUMN IF NOT EXISTS pinterest_analytics_updated_at TIMESTAMPTZ;

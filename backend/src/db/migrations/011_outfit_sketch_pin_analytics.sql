ALTER TABLE outfits ADD COLUMN IF NOT EXISTS sketch_pin_analytics JSONB;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS sketch_pin_analytics_updated_at TIMESTAMPTZ;

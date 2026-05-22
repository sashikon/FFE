ALTER TABLE outfits ADD COLUMN IF NOT EXISTS pinterest_exported JSONB DEFAULT '{}';

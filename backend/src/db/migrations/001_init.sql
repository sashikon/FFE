CREATE TABLE IF NOT EXISTS outfits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url   TEXT NOT NULL,
  thumb_url   TEXT,
  title       TEXT,
  file_hash   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE outfits ADD COLUMN IF NOT EXISTS file_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS outfits_file_hash_idx ON outfits(file_hash) WHERE file_hash IS NOT NULL;

-- Fix existing thumbnails: replace crop=fill with crop=fit
UPDATE outfits SET thumb_url = REPLACE(thumb_url, 'c_fill', 'c_fit') WHERE thumb_url LIKE '%c_fill%';

CREATE TABLE IF NOT EXISTS game_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id  UUID REFERENCES outfits(id) ON DELETE CASCADE,
  lang       VARCHAR(5) NOT NULL,
  score      INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  answers    JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outfit_translations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id   UUID REFERENCES outfits(id) ON DELETE CASCADE,
  lang        VARCHAR(5) NOT NULL,   -- 'ru' | 'en'
  analysis    JSONB,
  game_rows   JSONB,
  status      VARCHAR(20) DEFAULT 'pending',  -- pending | ready | error
  error_msg   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(outfit_id, lang)
);

CREATE TABLE IF NOT EXISTS outfits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url   TEXT NOT NULL,
  thumb_url   TEXT,
  title       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
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

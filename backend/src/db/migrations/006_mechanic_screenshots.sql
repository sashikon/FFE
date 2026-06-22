CREATE TABLE IF NOT EXISTS mechanic_screenshots (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mechanic_key VARCHAR(20) NOT NULL,
  image_url    TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mechanic_screenshots_key ON mechanic_screenshots(mechanic_key);

-- Визуалы по композиции: референсы, которые собираются в админке на /admin/compositions
CREATE TABLE IF NOT EXISTS visuals (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url    TEXT        NOT NULL,
  thumb_url    TEXT        NOT NULL,
  public_id    TEXT,
  file_hash    TEXT,
  compositions TEXT[]      NOT NULL DEFAULT '{}',
  note         TEXT        NOT NULL DEFAULT '',
  source_url   TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS visuals_file_hash ON visuals(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS visuals_compositions ON visuals USING GIN (compositions);

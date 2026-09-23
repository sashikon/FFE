-- Разметка типа перепроверяется один раз на тему: «mary jane» могла уехать в «термины»
ALTER TABLE trend_terms ADD COLUMN IF NOT EXISTS kind_checked BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_trend_terms_kind_checked ON trend_terms (kind_checked) WHERE NOT kind_checked;

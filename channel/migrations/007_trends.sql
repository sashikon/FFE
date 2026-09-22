-- Аналитика трендов: сущности (эстетика, вещь, бренд, термин…) и их упоминания во времени
CREATE TABLE trend_terms (
  id             SERIAL PRIMARY KEY,
  term           TEXT NOT NULL UNIQUE,   -- канон в нижнем регистре: «quiet luxury», «balletcore»
  display        TEXT NOT NULL,          -- как показывать: «Quiet luxury»
  kind           TEXT NOT NULL,          -- aesthetic | item | material | color | brand | term
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suggestions    JSONB,                  -- поисковые подсказки Google вокруг темы
  suggestions_at TIMESTAMPTZ
);

CREATE TABLE trend_mentions (
  id       SERIAL PRIMARY KEY,
  term_id  INT NOT NULL REFERENCES trend_terms(id) ON DELETE CASCADE,
  signal   TEXT NOT NULL,                -- news | search | screenshot
  ref      TEXT NOT NULL,                -- item:<id> | gtrends:<geo>:<дата>:<запрос> | …
  item_id  INT REFERENCES items(id) ON DELETE SET NULL,
  feed     TEXT,
  region   TEXT,
  seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (term_id, ref)
);
CREATE INDEX trend_mentions_term_time ON trend_mentions (term_id, seen_at);
CREATE INDEX trend_mentions_time ON trend_mentions (seen_at);

-- какие заметки уже разобраны на сущности
ALTER TABLE items ADD COLUMN trends_done BOOLEAN NOT NULL DEFAULT FALSE;

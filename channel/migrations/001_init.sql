-- Сюжет: несколько заметок об одном событии из разных источников
CREATE TABLE clusters (
  id           SERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- new → scored → (rejected | insight → drafted) | failed
  status       TEXT NOT NULL DEFAULT 'new',
  score        INT,
  lens         TEXT,
  score_reason TEXT,
  error_msg    TEXT
);

CREATE TABLE items (
  id           SERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  layer        TEXT NOT NULL,          -- industry | production | culture
  url          TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT,
  published_at TIMESTAMPTZ,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cluster_id   INT REFERENCES clusters(id)
);
CREATE INDEX items_cluster_idx ON items (cluster_id);
CREATE INDEX items_fetched_idx ON items (fetched_at);

-- Результат шага «частность → смысл»
CREATE TABLE insights (
  id          SERIAL PRIMARY KEY,
  cluster_id  INT NOT NULL UNIQUE REFERENCES clusters(id),
  data        JSONB NOT NULL,
  thesis      TEXT NOT NULL,
  lens        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE posts (
  id                 SERIAL PRIMARY KEY,
  insight_id         INT NOT NULL REFERENCES insights(id),
  text               TEXT NOT NULL,
  -- draft | approved | published | deferred | rejected | superseded
  status             TEXT NOT NULL DEFAULT 'draft',
  feedback           TEXT,
  review_message_id  BIGINT,
  channel_message_id BIGINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at        TIMESTAMPTZ,
  published_at       TIMESTAMPTZ
);
CREATE INDEX posts_status_idx ON posts (status);

CREATE TABLE bot_state (
  key   TEXT PRIMARY KEY,
  value JSONB
);

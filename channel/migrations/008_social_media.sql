-- Ролики и скриншоты соцсетей, присланные боту: полный разбор и картинки для админки
CREATE TABLE social_media (
  item_id    INT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,        -- screenshot | video
  platform   TEXT,
  author     TEXT,
  analysis   JSONB NOT NULL,       -- что вернула модель
  sound      TEXT,
  duration   REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX social_media_created ON social_media (created_at DESC);

-- кадры ролика (или сам скриншот как кадр 0), уменьшенные JPEG
CREATE TABLE social_frames (
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  idx     INT NOT NULL,
  at      REAL,
  jpeg    BYTEA NOT NULL,
  PRIMARY KEY (item_id, idx)
);

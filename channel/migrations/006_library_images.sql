-- Раньше на образ хранилась одна картинка. Теперь каждая картинка отдельно: эскиз и все рендеры
DROP TABLE IF EXISTS library;

CREATE TABLE library (
  image_id   TEXT PRIMARY KEY,          -- 'sketch:<outfit_id>' или 'render:<render_id>'
  outfit_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,             -- sketch | render
  title      TEXT NOT NULL,
  descriptor TEXT NOT NULL,
  image_url  TEXT NOT NULL,
  thumb_url  TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX library_outfit_idx ON library (outfit_id);

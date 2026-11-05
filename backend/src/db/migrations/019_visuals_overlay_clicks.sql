-- Что нарисовано поверх коллажа: текст плашки и загадка «Найди лишнее» ({text, position, puzzle: {count, odd}})
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS overlay JSONB;

-- Переходы на сайт по ссылкам пинов коллажей (?c=<первые 8 знаков id визуала>).
-- visitor — хэш IP за сутки, только чтобы не считать одного человека много раз; сам IP не храним
CREATE TABLE IF NOT EXISTS visual_clicks (
  id         BIGSERIAL   PRIMARY KEY,
  visual_id  UUID        NOT NULL REFERENCES visuals(id) ON DELETE CASCADE,
  visitor    TEXT,
  from_pinterest BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS visual_clicks_visual ON visual_clicks(visual_id, created_at);

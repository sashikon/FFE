-- Образы из игры FFE: картинка в Cloudinary + текстовое описание для подбора по смыслу
CREATE TABLE library (
  outfit_id  TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  descriptor TEXT NOT NULL,
  image_url  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE posts ADD COLUMN image_url TEXT;
ALTER TABLE posts ADD COLUMN image_ref TEXT;

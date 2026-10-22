-- Собственные исследования автора как источник постов.
-- Лента даёт частность, из которой ещё надо добыть смысл; в исследовании смысл уже есть,
-- и работа другая — найти в нём один-два самостоятельных сюжета и написать по каждому.
-- Дальше дорога та же: сюжет → разбор → скелет → текст → литредактура → бот
CREATE TABLE studies (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  text       TEXT NOT NULL,
  note       TEXT,                           -- что автор просила подчеркнуть
  -- new → planned → drafted | failed
  status     TEXT NOT NULL DEFAULT 'new',
  plan       JSONB,                           -- решение модели: сколько постов и почему
  error_msg  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Из какого исследования вышел сюжет: по этой связи видно, что получилось из текста
ALTER TABLE clusters ADD COLUMN study_id INT REFERENCES studies(id);
CREATE INDEX clusters_study_idx ON clusters (study_id);

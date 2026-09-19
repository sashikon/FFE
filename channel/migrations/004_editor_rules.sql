-- «Уроки редактора»: общие правила, извлечённые из комментариев автора к правкам
CREATE TABLE editor_rules (
  id             SERIAL PRIMARY KEY,
  rule           TEXT NOT NULL,
  source_post_id INT REFERENCES posts(id),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

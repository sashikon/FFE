-- Итог последнего сбора по каждой ленте: без него «ничего не пришло» не отличить
-- от «лента сломана» или «всё отсеяли фильтры» — ошибки сбора жили только в логах
CREATE TABLE source_checks (
  feed TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok BOOLEAN NOT NULL,
  error TEXT,
  last_ok_at TIMESTAMPTZ,
  seen INT NOT NULL DEFAULT 0,      -- сколько записей было в ленте
  too_old INT NOT NULL DEFAULT 0,   -- старше окна свежести
  filtered INT NOT NULL DEFAULT 0,  -- шум, тематический фильтр, пустые заголовки
  dup INT NOT NULL DEFAULT 0,       -- уже были в базе (в том числе из другой ленты)
  added INT NOT NULL DEFAULT 0,
  newest_seen TIMESTAMPTZ           -- самая свежая дата в ленте, даже если запись отсеяна
);

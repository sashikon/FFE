-- Вещи раскладываются на категорию (обувь, одежда, сумки…) и уровень: вид → модель
ALTER TABLE trend_terms ADD COLUMN category TEXT;
ALTER TABLE trend_terms ADD COLUMN parent_id INT REFERENCES trend_terms(id) ON DELETE SET NULL;
CREATE INDEX trend_terms_parent ON trend_terms (parent_id);

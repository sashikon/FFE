-- SEO-разметка визуалов (прежде всего коллажей) для пинов: заголовок, запасной заголовок, описание.
-- collage_of — из каких визуалов собран коллаж, чтобы при разметке знать, что на нём
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS seo_title_alt TEXT;
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS seo_lang VARCHAR(5);
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS seo_with_strategy BOOLEAN;
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS collage_of UUID[];

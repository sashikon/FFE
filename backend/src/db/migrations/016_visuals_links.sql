-- Визуалы из уже имеющихся образов и рендеров: ссылка на источник вместо повторной загрузки.
-- Если образ или рендер удалят, визуал уйдёт из коллекции вместе с ним
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS outfit_id UUID REFERENCES outfits(id) ON DELETE CASCADE;
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS render_id UUID REFERENCES outfit_renders(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS visuals_render ON visuals(render_id) WHERE render_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS visuals_outfit_sketch ON visuals(outfit_id) WHERE outfit_id IS NOT NULL AND render_id IS NULL;

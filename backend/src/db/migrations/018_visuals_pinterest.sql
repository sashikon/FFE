-- Когда визуал (коллаж) выгружен в CSV для Pinterest: такие не предлагаются к экспорту повторно
ALTER TABLE visuals ADD COLUMN IF NOT EXISTS pinterest_exported_at TIMESTAMPTZ;

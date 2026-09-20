-- Название нашей ленты-источника: у поисковых лент items.source — издание-первоисточник
ALTER TABLE items ADD COLUMN feed TEXT;
UPDATE items SET feed = source WHERE feed IS NULL;
CREATE INDEX items_feed_idx ON items (feed);

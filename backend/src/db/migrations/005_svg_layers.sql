CREATE TABLE IF NOT EXISTS outfit_svg_layers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id  UUID        NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  label      VARCHAR(100) NOT NULL DEFAULT '',
  svg_url    TEXT        NOT NULL,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outfit_svg_layers_outfit_id ON outfit_svg_layers(outfit_id);

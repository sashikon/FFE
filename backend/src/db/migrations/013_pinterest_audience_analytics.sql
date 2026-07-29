CREATE TABLE IF NOT EXISTS pinterest_audience_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  file_name TEXT NOT NULL,
  report_type TEXT,          -- 'audience_insights'|'top_pins'|'overview'|'search_terms'|'unknown'
  date_from DATE,
  date_to DATE,
  raw_csv TEXT,
  insights JSONB,            -- AI-extracted: {summary, audience, top_keywords, opportunities, recommended_keywords}
  strategy_contribution TEXT -- one-paragraph digest for strategy synthesis
);

CREATE TABLE IF NOT EXISTS pinterest_seo_strategy (
  id INTEGER PRIMARY KEY DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  report_count INTEGER DEFAULT 0,
  top_keywords JSONB,        -- [{keyword, score, sources}]
  audience_affinities JSONB, -- [{interest, affinity}]
  opportunities JSONB,       -- [{topic, reason}]
  prompt_injection TEXT,     -- ready-to-use text block for generate-seo prompt
  strategy_notes TEXT        -- AI narrative
);

-- Migration 020: Wiki page popularity scores
-- Stores composite popularity score per wiki page combining inbound links,
-- citation frequency, and edit recency.

CREATE TABLE wiki_page_popularity (
  id              SERIAL PRIMARY KEY,
  page_id         INTEGER NOT NULL UNIQUE,
  page_title      TEXT NOT NULL,

  -- Individual signals
  inbound_links   INTEGER NOT NULL DEFAULT 0,
  citation_count  INTEGER NOT NULL DEFAULT 0,
  edit_recency_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,

  -- Composite
  composite_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,

  -- Freshness tracking per signal source
  last_scored_at        TIMESTAMPTZ,
  last_linkshere_fetch  TIMESTAMPTZ,
  last_citation_reset   TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by composite score for top-N queries
CREATE INDEX idx_wiki_page_popularity_score
  ON wiki_page_popularity (composite_score DESC);

-- FK-style lookup by page_id (not enforced FK since wiki_pages has multiple rows per page_id)
CREATE INDEX idx_wiki_page_popularity_page_id
  ON wiki_page_popularity (page_id);

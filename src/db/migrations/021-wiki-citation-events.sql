-- Migration 021: Wiki citation event log
-- Lightweight append-only log of when wiki pages appear in retrieval results.
-- Used for rolling-window citation frequency aggregation.

CREATE TABLE wiki_citation_events (
  id        BIGSERIAL PRIMARY KEY,
  page_id   INTEGER NOT NULL,
  cited_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for rolling window aggregation (count citations in last 90 days)
CREATE INDEX idx_wiki_citation_events_page_cited
  ON wiki_citation_events (page_id, cited_at);

-- Index for cleanup of old events
CREATE INDEX idx_wiki_citation_events_cited_at
  ON wiki_citation_events (cited_at);

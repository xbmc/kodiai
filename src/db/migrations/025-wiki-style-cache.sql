-- Wiki style cache: stores LLM-extracted page style descriptions with TTL.
-- Content-hash invalidation ensures stale descriptions are refreshed when page content changes.

CREATE TABLE wiki_style_cache (
  page_id           INTEGER PRIMARY KEY,
  page_title        TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  style_description JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_wiki_style_cache_expires ON wiki_style_cache (expires_at);

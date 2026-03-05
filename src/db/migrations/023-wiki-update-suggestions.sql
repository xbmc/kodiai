-- Wiki update suggestions: stores LLM-generated section-level rewrite suggestions
-- for stale wiki pages, grounded in PR evidence. Consumed by Phase 124 (publishing).

CREATE TABLE wiki_update_suggestions (
  id                    SERIAL PRIMARY KEY,
  page_id               INTEGER NOT NULL,
  page_title            TEXT NOT NULL,
  section_heading       TEXT,             -- NULL for lead/intro section
  original_content      TEXT NOT NULL,
  suggestion            TEXT NOT NULL,
  why_summary           TEXT NOT NULL,     -- 1-2 sentence explanation
  grounding_status      TEXT NOT NULL DEFAULT 'grounded'
                        CHECK (grounding_status IN ('grounded', 'ungrounded', 'no_update')),
  citing_prs            JSONB NOT NULL DEFAULT '[]'::jsonb,
  voice_mismatch_warning BOOLEAN NOT NULL DEFAULT false,
  voice_scores          JSONB,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Functional unique index using COALESCE to handle NULL section_heading properly.
-- PostgreSQL UNIQUE constraints treat NULLs as distinct; this ensures only one
-- suggestion per (page_id, section) including the NULL/lead section.
CREATE UNIQUE INDEX idx_wiki_update_suggestions_page_section
  ON wiki_update_suggestions (page_id, COALESCE(section_heading, ''));

CREATE INDEX idx_wiki_update_suggestions_page_id ON wiki_update_suggestions (page_id);
CREATE INDEX idx_wiki_update_suggestions_grounding ON wiki_update_suggestions (grounding_status);
CREATE INDEX idx_wiki_update_suggestions_generated ON wiki_update_suggestions (generated_at DESC);

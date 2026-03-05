-- PR evidence table: stores patch hunks from merged PRs matched to wiki pages
-- for grounding staleness detection with concrete code change evidence.

CREATE TABLE wiki_pr_evidence (
  id              SERIAL PRIMARY KEY,
  pr_number       INTEGER NOT NULL,
  pr_title        TEXT NOT NULL,
  pr_description  TEXT,
  pr_author       TEXT NOT NULL,
  merged_at       TIMESTAMPTZ NOT NULL,
  file_path       TEXT NOT NULL,
  patch           TEXT NOT NULL,
  issue_references JSONB DEFAULT '[]'::jsonb,
  matched_page_id    INTEGER,
  matched_page_title TEXT,
  heuristic_score    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pr_number, file_path, matched_page_id)
);

CREATE INDEX idx_wiki_pr_evidence_page_id ON wiki_pr_evidence (matched_page_id);
CREATE INDEX idx_wiki_pr_evidence_merged_at ON wiki_pr_evidence (merged_at DESC);
CREATE INDEX idx_wiki_pr_evidence_pr_number ON wiki_pr_evidence (pr_number);

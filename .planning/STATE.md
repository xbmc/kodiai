---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: milestone
status: unknown
stopped_at: "Completed quick-12: closed issue #42"
last_updated: "2026-02-25T21:26:34.661Z"
progress:
  total_phases: 79
  completed_phases: 76
  total_plans: 186
  completed_plans: 195
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-25)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.19 complete — planning next milestone

## Current Position

Phase: 96 of 96 (code-snippet-embedding)
Plan: 4 of 4 in current phase
Status: Milestone Complete
Last activity: 2026-02-25 -- v0.19 milestone shipped

Progress: [████████████████████] 241/241 plans (100%)

## Accumulated Context

### Decisions

All decisions through v0.19 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- All corpora use voyage-code-3 (1024 dims) -- consistent model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path

### Key Infrastructure (v0.17-v0.19 Foundation)

- PostgreSQL + pgvector with HNSW indexes (m=16, ef_construction=64) and tsvector GIN indexes
- Four knowledge corpora: `learning_memories` (code), `review_comments`, `wiki_pages`, `code_snippets` (PR diff hunks)
- `createRetriever()` factory: single dep injection point for all retrieval
- Unified cross-corpus retrieval: BM25+vector hybrid per corpus, RRF merge, cosine dedup, source attribution
- Language-aware retrieval boosting with proportional multi-language boost
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

- `checks:read` GitHub App permission needs verification -- may require App manifest update
- Search API rate limit (30/min) requires caching strategy validated under production load

## Session Continuity

**Last session:** 2026-02-25T21:26:34.658Z
**Stopped At:** Completed quick-12: closed issue #42
**Resume file:** None

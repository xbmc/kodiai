---
gsd_state_version: 1.0
milestone: v0.20
milestone_name: Multi-Model & Active Intelligence
status: defining_requirements
stopped_at: ""
last_updated: "2026-02-25"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-25)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.20 Multi-Model & Active Intelligence

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-02-25 — Milestone v0.20 started

Progress: [░░░░░░░░░░░░░░░░░░░░] 0/0 plans (0%)

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

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 12 | Close/comment on all open issues that have been addressed | 2026-02-25 | dcc58da641 | [12-go-thru-and-close-comment-on-all-open-is](./quick/12-go-thru-and-close-comment-on-all-open-is/) |

## Session Continuity

**Last session:** 2026-02-25T21:26:34.658Z
**Stopped At:** Completed quick-12: closed issue #42
**Resume file:** None

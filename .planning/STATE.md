# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-25)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Planning next milestone

## Current Position

**Milestone:** v0.18 Knowledge Ingestion — SHIPPED
**Status:** Complete
Last activity: 2026-02-25 - Completed quick task 8: Issue triage — close #65, bump version labels on #73/#74/#75

Progress: [##########] 100% (18 milestones shipped, 92 phases, 227 plans)

## Accumulated Context

### Decisions

All decisions through v0.18 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- Checkpoint publishing must use buffer-and-flush on abort, not streaming
- Existing `learning_memories` table uses voyage-code-3 (1024 dims) — all corpora use same model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path

### Key Infrastructure (v0.17-v0.18 Foundation)

- PostgreSQL + pgvector with HNSW indexes (m=16, ef_construction=64) and tsvector GIN indexes
- Three knowledge corpora: `learning_memories` (code), `review_comments`, `wiki_pages`
- `createRetriever()` factory: single dep injection point for all retrieval, optional `learningMemoryStore` for hybrid search
- Unified cross-corpus retrieval: BM25+vector hybrid per corpus, RRF merge, cosine dedup, source attribution
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns
- Incremental sync: webhooks for review comments, scheduled job for wiki pages

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Roadmap Evolution

(None — planning next milestone)

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |
| 5 | Merge feat/issue-write-pr to main and redeploy to Azure | 2026-02-19 | e5bc338ce4 | [5-merge-feat-issue-write-pr-to-main-and-re](./quick/5-merge-feat-issue-write-pr-to-main-and-re/) |
| 6 | Extensive code review of entire codebase (97 files, 23,570 lines) | 2026-02-20 | ae782876aa | [6-extensive-code-review](./quick/6-extensive-code-review/) |
| 7 | Fix all PR #67 review comments | 2026-02-25 | 47b30fb5dd | [7-fix-all-pr-67-review-comments](./quick/7-fix-all-pr-67-review-comments/) |
| 8 | Issue triage: close #65, bump version labels on #73/#74/#75 | 2026-02-25 | 96ef6a0922 | [8-read-thru-the-open-issues-close-comment-](./quick/8-read-thru-the-open-issues-close-comment-/) |

## Session Continuity

**Last session:** 2026-02-25
**Stopped At:** Quick task 8 complete — issue triage done, next milestone is v0.19
**Resume file:** .planning/MILESTONES.md

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-25)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 92 — Wire Unified Retrieval to All Consumers (complete)

## Current Position

**Milestone:** v0.18 Knowledge Ingestion
**Source:** [Issue #65](https://github.com/xbmc/kodiai/issues/65)
**Status:** Milestone complete
**Last Activity:** 2026-02-25

Progress: [##########] 100% (4/4 phases)

### Phase Status

| Phase | Title | Status |
|-------|-------|--------|
| 89 | PR Review Comment Ingestion | Complete (5/5 plans) |
| 90 | MediaWiki Content Ingestion | Complete (3/3 plans) |
| 91 | Cross-Corpus Retrieval Integration | Complete (4/4 plans) |
| 92 | Wire Unified Retrieval to All Consumers | Complete (3/3 plans) |

## Accumulated Context

### Decisions

All decisions through v0.17 archived to `.planning/PROJECT.md` Key Decisions table.

- **Phase 89-01:** Whitespace-based token counting for chunker (no external tokenizer dependency)
- **Phase 89-01:** ON CONFLICT DO NOTHING for idempotent backfill writes
- **Phase 89-01:** Bot filtering via configurable Set<string> plus [bot] suffix detection
- **Phase 89-01:** updateChunks uses DELETE + INSERT in transaction for re-chunking on edit
- **Phase 89-03:** Standalone chunk per new comment (no thread re-chunking on reply) for simplicity
- **Phase 89-03:** Delete handler calls softDelete directly (no job queue) since no embedding needed
- **Phase 89-03:** Bot filtering in handler layer before job enqueueing to avoid wasting queue slots
- [Phase 89]: Phase 89-02: Adaptive rate limiting with 1.5s delay at <50% remaining, 3s delay at <20%
- [Phase 89]: Phase 89-02: Thread grouping via in_reply_to_id chains from flat GitHub API responses
- [Phase 89]: Phase 89-02: CLI uses GitHub App auth with getRepoInstallationContext for installation discovery
- [Phase 89]: Phase 89-04: 0.7 cosine distance default threshold for review comment search (tunable in Phase 91)
- [Phase 89]: Phase 89-04: Review comment results independent from learning memory (separate reviewPrecedents array)
- [Phase 89]: Phase 89-04: topK=5 separate budget for review comment search
- [Phase 89]: Phase 89-05: Mutate chunk.embedding in-place rather than returning separate embedding arrays
- [Phase 89]: Phase 89-05: voyage-code-3 hardcoded as embedding_model (matches learning_memories convention)
- [Phase 89]: Phase 89-05: NULL embedding filter in searchByEmbedding to prevent NaN cosine distances

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- Checkpoint publishing must use buffer-and-flush on abort, not streaming
- Existing `learning_memories` table uses voyage-code-3 (1024 dims) — new corpora should use same model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path

### Key Infrastructure (v0.17 Foundation)

- PostgreSQL + pgvector with HNSW indexes (m=16, ef_construction=64) and tsvector GIN indexes
- `learning_memories` table: existing vector storage for review findings
- `createRetriever()` factory: single dep injection point for all retrieval
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns
- Multi-query retrieval: 3 variants (intent, file-path, code-shape) with weighted merge
- Isolation layer: repo-scoped + owner-level shared pool retrieval

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Roadmap Evolution

(None yet for v0.18)

### Blockers/Concerns

- GitHub API rate limits for 18-month backfill (~5000 requests/hour for authenticated apps)
- kodi.wiki size/page count unknown — may need namespace filtering
- Search API rate limit (30/min) requires caching strategy validated under production load

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |
| 5 | Merge feat/issue-write-pr to main and redeploy to Azure | 2026-02-19 | e5bc338ce4 | [5-merge-feat-issue-write-pr-to-main-and-re](./quick/5-merge-feat-issue-write-pr-to-main-and-re/) |
| 6 | Extensive code review of entire codebase (97 files, 23,570 lines) | 2026-02-20 | ae782876aa | [6-extensive-code-review](./quick/6-extensive-code-review/) |
| 7 | Fix all PR #67 review comments | 2026-02-25 | 47b30fb5dd | [7-fix-all-pr-67-review-comments](./quick/7-fix-all-pr-67-review-comments/) |

## Session Continuity

**Last session:** 2026-02-24
**Stopped At:** Phase 92 complete — all v0.18 requirements satisfied
**Resume file:** .planning/phases/92-wire-unified-retrieval-consumers/92-03-SUMMARY.md

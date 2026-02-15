# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-15)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 58 - Intelligence Layer (v0.10 Advanced Signals)

## Current Position

**Milestone:** v0.10 Advanced Signals
**Phase:** 58 (3 of 4 in v0.10)
**Current Plan:** 2
**Total Plans in Phase:** 2
**Status:** Ready to execute
**Last Activity:** 2026-02-15

**Progress:** [██████████] 100%

## Performance Metrics

| Plan | Duration | Scope | Files |
|------|----------|-------|-------|
| Phase 56 P01 | 6min | 2 tasks | 6 files |
| Phase 56 P02 | 9m | 2 tasks | 5 files |
| Phase 56 P03 | 4m | 2 tasks | 5 files |
| Phase 57 P01 | 6m | 2 tasks | 4 files |
| Phase 57 P02 | 0m | 1 task | 2 files |
| Phase 57 P03 | 11m | 2 tasks | 5 files |
| Phase 58 P01 | 3m | 1 tasks | 2 files |

## Accumulated Context

### Decisions

All v0.9 decisions archived to `.planning/PROJECT.md` Key Decisions table.
- [Phase 56]: Store dep bump merge history in knowledge DB keyed by (repo, pr_number) using INSERT OR IGNORE to handle redeliveries
- [Phase 56]: Use INSERT OR IGNORE with a partial unique index on retrieval_quality(delivery_id) to dedupe webhook redeliveries
- [Phase 56]: Compute retrieval avg_distance and language_match_ratio from reranked adjustedDistance/languageMatch (not raw distances)
- [Phase 57-analysis-layer]: Expose a test-only grep runner hook to make timeout behavior deterministic in unit tests
- [Phase 57-analysis-layer]: Added optional dependency injection hooks in createReviewHandler for deterministic unit tests (no behavior change in production).

### Key Constraints for v0.10

- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- Recency weighting needs severity-aware decay floor (0.3 minimum)
- Checkpoint publishing must use buffer-and-flush on abort, not streaming
- Schema migrations must be additive-only (new tables, nullable columns)

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |

## Session Continuity

**Last session:** 2026-02-15T20:56:02.003Z
**Stopped At:** Completed 58-01-PLAN.md
**Resume File:** None
**Next action:** Plan and execute Phase 58

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-16)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Milestone v0.11 -- defining requirements

## Current Position

**Milestone:** v0.11 Issue Workflows
**Phase:** Not started (defining requirements)
**Current Plan:** —
**Total Plans in Phase:** —
**Status:** Defining requirements
**Last Activity:** 2026-02-16 — Milestone v0.11 started

**Progress:** [░░░░░░░░░░] 0%

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
| Phase 58 P02 | 7m | 2 tasks | 11 files |
| Phase 59 P01 | 2min | 2 tasks | 4 files |
| Phase 59 P02 | 1min | 2 tasks | 6 files |
| Phase 59 P03 | 9min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

All v0.9 decisions archived to `.planning/PROJECT.md` Key Decisions table.
- [Phase 56]: Store dep bump merge history in knowledge DB keyed by (repo, pr_number) using INSERT OR IGNORE to handle redeliveries
- [Phase 56]: Use INSERT OR IGNORE with a partial unique index on retrieval_quality(delivery_id) to dedupe webhook redeliveries
- [Phase 56]: Compute retrieval avg_distance and language_match_ratio from reranked adjustedDistance/languageMatch (not raw distances)
- [Phase 57-analysis-layer]: Expose a test-only grep runner hook to make timeout behavior deterministic in unit tests
- [Phase 57-analysis-layer]: Added optional dependency injection hooks in createReviewHandler for deterministic unit tests (no behavior change in production).
- [Phase 58]: Made adaptive thresholds default-on via retrieval.adaptive (opt-out) to preserve legacy behavior while meeting RET-03 requirements.

### Key Constraints (Carry-Forward)

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

**Last session:** 2026-02-16T00:02:37.145Z
**Stopped At:** Milestone v0.11 started (requirements pending)
**Resume File:** None
**Next action:** Define v0.11 requirements

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-15)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 56 - Foundation Layer (v0.10 Advanced Signals)

## Current Position

**Milestone:** v0.10 Advanced Signals
**Phase:** 56 (1 of 4 in v0.10)
**Plan:** 0 of TBD in current phase
**Status:** Ready to plan
**Last Activity:** 2026-02-15 -- v0.10 roadmap created (Phases 56-59)

**Progress:** [░░░░░░░░░░] 0% (of v0.10)

## Performance Metrics

**Velocity:**
- Total plans completed: 156
- Total milestones shipped: 9
- Total phases completed: 55

## Accumulated Context

### Decisions

All v0.9 decisions archived to `.planning/PROJECT.md` Key Decisions table.

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

**Last session:** 2026-02-15
**Stopped At:** v0.10 roadmap created, ready to plan Phase 56
**Resume File:** None
**Next action:** Plan Phase 56 (Foundation Layer)

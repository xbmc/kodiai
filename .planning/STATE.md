# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-24)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Planning next milestone

## Current Position

**Milestone:** v0.16 Review Coverage & Slack UX — SHIPPED
**Phase:** All complete (82-85)
**Status:** Milestone complete, ready for next
**Last Activity:** 2026-02-24

**Progress:** [██████████] 100%

## Performance Metrics

| Plan | Duration | Scope | Files |
|------|----------|-------|-------|
| Phase 82 P01 | 4 min | 2 tasks | 6 files |
| Phase 83 P01 | 1 min | 2 tasks | 2 files |
| Phase 84 P01 | 2 min | 2 tasks | 2 files |
| Phase 84 P02 | 5 min | 2 tasks | 1 files |
| Phase 85 P01 | 4 min | 2 tasks | 7 files |
| Phase 85 P02 | 6 min | 2 tasks | 10 files |

## Accumulated Context

### Decisions

All decisions through v0.16 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- Recency weighting needs severity-aware decay floor (0.3 minimum)
- Checkpoint publishing must use buffer-and-flush on abort, not streaming
- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Roadmap Evolution

None — clean slate for next milestone.

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |
| 5 | Merge feat/issue-write-pr to main and redeploy to Azure | 2026-02-19 | e5bc338ce4 | [5-merge-feat-issue-write-pr-to-main-and-re](./quick/5-merge-feat-issue-write-pr-to-main-and-re/) |
| 6 | Extensive code review of entire codebase (97 files, 23,570 lines) | 2026-02-20 | ae782876aa | [6-extensive-code-review](./quick/6-extensive-code-review/) |

## Session Continuity

**Last session:** 2026-02-24
**Stopped At:** v0.16 milestone completed
**Resume File:** .planning/MILESTONES.md
**Next action:** /gsd:new-milestone to define next milestone

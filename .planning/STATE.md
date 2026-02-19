# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-19)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.16 Review Coverage & Slack UX

## Current Position

**Milestone:** v0.16 Review Coverage & Slack UX
**Phase:** 82 of 83 (Draft PR Review Coverage) -- ready to plan
**Status:** Ready to plan
**Last Activity:** 2026-02-19 -- Roadmap created

**Progress:** [░░░░░░░░░░] 0%

## Performance Metrics

| Plan | Duration | Scope | Files |
|------|----------|-------|-------|
| Phase 81 P01 | 4 min | 2 tasks | 6 files |
| Phase 81 P02 | 7 min | 2 tasks | 9 files |
| Phase 81 P03 | 5 min | 2 tasks | 4 files |
| Phase 81 P04 | 1 min | 2 tasks | 6 files |

## Accumulated Context

### Decisions

All decisions through v0.15 archived to `.planning/PROJECT.md` Key Decisions table.

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

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |
| 5 | Merge feat/issue-write-pr to main and redeploy to Azure | 2026-02-19 | e5bc338ce4 | [5-merge-feat-issue-write-pr-to-main-and-re](./quick/5-merge-feat-issue-write-pr-to-main-and-re/) |

## Session Continuity

**Last session:** 2026-02-19
**Stopped At:** v0.16 roadmap created
**Resume File:** None
**Next action:** `/gsd:plan-phase 82`

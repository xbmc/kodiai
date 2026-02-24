# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-23)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 86 - PostgreSQL + pgvector on Azure

## Current Position

**Milestone:** v0.17 Infrastructure Foundation
**Phase:** 86 of 88 (PostgreSQL + pgvector on Azure)
**Plan:** 0 of ? in current phase
**Status:** Ready to plan
**Last Activity:** 2026-02-23 — Roadmap created for v0.17

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

All decisions through v0.16 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- Checkpoint publishing must use buffer-and-flush on abort, not streaming

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
| 6 | Extensive code review of entire codebase (97 files, 23,570 lines) | 2026-02-20 | ae782876aa | [6-extensive-code-review](./quick/6-extensive-code-review/) |

## Session Continuity

**Last session:** 2026-02-24T03:34:16.444Z
**Stopped At:** Phase 86 context gathered
**Resume File:** .planning/phases/86-postgresql-pgvector-on-azure/86-CONTEXT.md
**Next action:** `/gsd:plan-phase 86`

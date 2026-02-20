# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-19)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.16 Review Coverage & Slack UX

## Current Position

**Milestone:** v0.16 Review Coverage & Slack UX
**Phase:** 82 of 84 (Draft PR Review Coverage) -- ready to plan
**Status:** Milestone complete
**Last Activity:** 2026-02-20

**Progress:** [██████████] 104%

## Performance Metrics

| Plan | Duration | Scope | Files |
|------|----------|-------|-------|
| Phase 81 P01 | 4 min | 2 tasks | 6 files |
| Phase 81 P02 | 7 min | 2 tasks | 9 files |
| Phase 81 P03 | 5 min | 2 tasks | 4 files |
| Phase 81 P04 | 1 min | 2 tasks | 6 files |
| Phase 84 P01 | 2 min | 2 tasks | 2 files |
| Phase 84 P02 | 5 min | 2 tasks | 1 files |

## Accumulated Context

### Decisions

All decisions through v0.15 archived to `.planning/PROJECT.md` Key Decisions table.
- [Phase 84]: Embeddings smoke test uses void Promise pattern, non-blocking, logs pass/fail at boot
- [Phase 84]: Dockerfile must use Debian (not Alpine) for sqlite-vec glibc compatibility

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

- Phase 84 added: Azure deployment health — verify embeddings/VoyageAI work on deploy and fix container log errors

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |
| 5 | Merge feat/issue-write-pr to main and redeploy to Azure | 2026-02-19 | e5bc338ce4 | [5-merge-feat-issue-write-pr-to-main-and-re](./quick/5-merge-feat-issue-write-pr-to-main-and-re/) |

## Session Continuity

**Last session:** 2026-02-20T02:46:00.000Z
**Stopped At:** Completed 84-02-PLAN.md (all phase 84 plans done)
**Resume File:** None
**Next action:** Phase 84 verification

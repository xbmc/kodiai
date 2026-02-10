---
phase: 13-xbmc-cutover
plan: 03
subsystem: ops
tags: [xbmc, runbook, operations, github, mentions, review_requested]

# Dependency graph
requires:
  - phase: 13-xbmc-cutover
    provides: Cutover completed and parity smoke tested
provides:
  - xbmc-specific day-2 ops runbook for Kodiai maintainers
affects: [ops, docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Debug by deliveryId: GitHub App deliveries -> logs -> handler gate decision -> publish"

key-files:
  created:
    - docs/runbooks/xbmc-ops.md
  modified: []

key-decisions:
  - "Keep the xbmc ops runbook short and link out to the generic mentions/review_requested runbooks for deep dives."

patterns-established: []

# Metrics
duration: 8 min
completed: 2026-02-10
---

# Phase 13 Plan 03: xbmc Ops Runbook Summary

**Added a single-page, xbmc-specific runbook that explains Kodiai triggers, failure modes, and evidence collection (deliveryId-first) for maintainers.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-10T05:41:39Z
- **Completed:** 2026-02-10T05:49:39Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `docs/runbooks/xbmc-ops.md` covering:
  - Trigger map (opened/ready_for_review/review_requested + mention surfaces)
  - First-look workflow: deliveries UI -> `deliveryId` correlation -> handler outcome
  - Common intentional skips vs real failures
  - Fork PR workspace strategy (base clone + `pull/<n>/head`)
  - Idempotency expectations and what redeliveries should look like
  - Minimal reproduction templates maintainers can paste
- Linked to the deeper generic runbooks:
  - `docs/runbooks/mentions.md`
  - `docs/runbooks/review-requested-debug.md`

## Task Commits

Not committed in this session.

## Files Created/Modified

- `docs/runbooks/xbmc-ops.md` - xbmc-specific day-2 operations and evidence collection.

---
*Phase: 13-xbmc-cutover*
*Completed: 2026-02-10*

## Self-Check: PASSED

- FOUND: `docs/runbooks/xbmc-ops.md`
- FOUND: `.planning/phases/13-xbmc-cutover/13-03-SUMMARY.md`

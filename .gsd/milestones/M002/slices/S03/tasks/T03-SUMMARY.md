---
id: T03
parent: S03
milestone: M002
provides:
  - xbmc-specific day-2 ops runbook for Kodiai maintainers
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 8 min
verification_result: passed
completed_at: 2026-02-10
blocker_discovered: false
---
# T03: 13-xbmc-cutover 03

**# Phase 13 Plan 03: xbmc Ops Runbook Summary**

## What Happened

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

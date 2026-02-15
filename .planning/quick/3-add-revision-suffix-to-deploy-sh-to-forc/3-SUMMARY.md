---
phase: quick-3
plan: 01
subsystem: infra
tags: [azure, container-apps, deployment, revision-suffix]

requires:
  - phase: none
    provides: n/a
provides:
  - Forced revision creation on every deployment via --revision-suffix
affects: [deploy]

tech-stack:
  added: []
  patterns: [timestamp-based revision suffix for deployment traceability]

key-files:
  created: []
  modified: [deploy.sh]

key-decisions:
  - "Timestamp format YYYYMMDD-HHMMSS for revision suffix traceability"

patterns-established:
  - "Revision suffix pattern: deploy-YYYYMMDD-HHMMSS"

duration: 1min
completed: 2026-02-12
---

# Quick Task 3: Add --revision-suffix to deploy.sh Summary

**Timestamp-based --revision-suffix on az containerapp update to force new revision on every deploy**

## Performance

- **Duration:** <1 min
- **Started:** 2026-02-12T00:53:53Z
- **Completed:** 2026-02-12T00:54:30Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added REVISION_SUFFIX variable with deploy-YYYYMMDD-HHMMSS timestamp format
- Added --revision-suffix flag to the az containerapp update command
- Updated echo message to show revision suffix during deployment
- Only the existing-app update path modified; create path and YAML probe path untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Add --revision-suffix to az containerapp update** - `cb55e0fcfa` (feat)

## Files Created/Modified
- `deploy.sh` - Added --revision-suffix flag with timestamp to az containerapp update command

## Decisions Made
- Used `deploy-$(date +%Y%m%d-%H%M%S)` format for revision suffix to provide clear deployment traceability while remaining valid as an Azure revision name

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- deploy.sh now forces a new revision on every deployment
- No blockers or concerns

---
*Quick Task: 3-add-revision-suffix-to-deploy-sh-to-forc*
*Completed: 2026-02-12*

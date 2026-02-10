---
phase: 13-xbmc-cutover
plan: 01
subsystem: infra
tags: [github-app, webhooks, xbmc, cutover, runbook]

# Dependency graph
requires:
  - phase: 12-fork-pr-robustness
    provides: fork-safe PR fetch + mention/review reliability hardening
provides:
  - xbmc/xbmc cutover runbook (app install + webhook + smoke tests)
  - verified Kodiai GitHub App install + webhook delivery to Azure Container Apps
affects: [ops, rollout, docs, github]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Use GitHub App deliveries UI + deliveryId-correlated ACA logs for webhook smoke tests"

key-files:
  created:
    - docs/runbooks/xbmc-cutover.md
    - .planning/phases/13-xbmc-cutover/13-xbmc-cutover-USER-SETUP.md
    - .planning/phases/13-xbmc-cutover/13-01-SUMMARY.md
  modified:
    - .planning/STATE.md

key-decisions:
  - "Accept GitHub App delivery UI evidence + ACA logs as the primary verification path (gh delivery API scope is not guaranteed)"

patterns-established: []

# Metrics
duration: 1min
completed: 2026-02-10
---

# Phase 13 Plan 01: xbmc Cutover Summary

**xbmc/xbmc is cut over to the Kodiai GitHub App with a runbook and verified webhook delivery to `/webhooks/github`.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-10T05:13:31Z
- **Completed:** 2026-02-10T05:15:28Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Wrote an actionable cutover runbook covering permissions, webhook semantics, delivery verification, smoke tests, and legacy workflow removal.
- Verified the Kodiai GitHub App is installed on `xbmc/xbmc` and webhook deliveries reach the Azure Container Apps deployment.
- Captured the human-only setup steps in a phase-scoped USER-SETUP doc for future rollouts.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write xbmc cutover runbook (install + webhook + smoke tests)** - `8b6f6ccbed` (docs)
2. **Task 2: Install Kodiai GitHub App on xbmc/xbmc and configure webhook** - (checkpoint:human-action; verified externally)

**Plan metadata:** (added after completion)

## Files Created/Modified

- `docs/runbooks/xbmc-cutover.md` - xbmc/xbmc cutover checklist, permissions, webhook semantics, smoke tests, and troubleshooting.
- `.planning/phases/13-xbmc-cutover/13-xbmc-cutover-USER-SETUP.md` - human-only GitHub App install + webhook verification checklist.
- `.planning/phases/13-xbmc-cutover/13-01-CHECKPOINT-SUMMARY.md` - checkpoint state recorded while awaiting the human-action gate.
- `.planning/phases/13-xbmc-cutover/13-01-SUMMARY.md` - plan completion summary.
- `.planning/STATE.md` - advanced phase position and recorded execution metrics.

## Decisions Made

- Used GitHub App deliveries UI + ACA logs as the primary verification path since `gh` delivery APIs may require `admin:repo_hook` scope.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

External service configuration was required. See `13-xbmc-cutover-USER-SETUP.md`.

## Next Phase Readiness

- xbmc/xbmc cutover is complete; remaining phase plans can focus on cleanup and follow-on hardening.

## Self-Check: PASSED

- Key files exist on disk (`docs/runbooks/xbmc-cutover.md`, `.planning/phases/13-xbmc-cutover/13-xbmc-cutover-USER-SETUP.md`, `.planning/phases/13-xbmc-cutover/13-01-SUMMARY.md`).
- Task commits referenced in this summary exist in git history (`8b6f6ccbed`, `fb0e584097`).

---
*Phase: 13-xbmc-cutover*
*Completed: 2026-02-10*

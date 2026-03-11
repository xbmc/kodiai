---
id: S03
parent: M002
milestone: M002
provides:
  - Legacy Claude GitHub Actions workflows removed/disabled on xbmc/xbmc
  - Verified Kodiai parity for ready_for_review + @claude mention surfaces
  - xbmc-specific day-2 ops runbook for Kodiai maintainers
  - xbmc/xbmc cutover runbook (app install + webhook + smoke tests)
  - verified Kodiai GitHub App install + webhook delivery to Azure Container Apps
requires: []
affects: []
key_files: []
key_decisions:
  - "Treat review_requested remove+re-request as UI-only verification: GitHub APIs do not allow requesting a GitHub App as a reviewer from CLI."
  - "Keep the xbmc ops runbook short and link out to the generic mentions/review_requested runbooks for deep dives."
  - "Accept GitHub App delivery UI evidence + ACA logs as the primary verification path (gh delivery API scope is not guaranteed)"
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 1min
verification_result: passed
completed_at: 2026-02-10
blocker_discovered: false
---
# S03: Xbmc Cutover

**# Phase 13 Plan 02: xbmc Cutover (Disable Legacy Workflows + Parity Smoke Test) Summary**

## What Happened

# Phase 13 Plan 02: xbmc Cutover (Disable Legacy Workflows + Parity Smoke Test) Summary

**Disabled/removed the legacy `@claude` GitHub Actions workflows and smoke-tested that Kodiai provides equivalent developer UX for auto-review and @claude mentions without duplicate responders.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-10T05:30:58Z
- **Completed:** 2026-02-10T05:40:20Z
- **Tasks:** 2 (human-action + human-verify)
- **Files modified:** 0 (repo-side actions + external verification)

## Accomplishments

- Removed/disabled the legacy Claude GitHub Actions workflows in `xbmc/xbmc` (user-confirmed).
- Created a safe, doc-only smoke test PR and used it to validate the cutover end-to-end:
  - `ready_for_review` triggers an auto-review from `kodiai[bot]`.
  - Top-level PR comment `@claude ...` produces an eyes reaction (best-effort) and a reply comment.
  - Inline diff thread `@claude ...` produces an in-thread reply.
- Confirmed there is no longer a duplicate responder path attributable to legacy workflows.

Evidence PR: https://github.com/xbmc/xbmc/pull/27834

## Task Commits

None (no code changes in this repository).

## Deviations from Plan

### review_requested remove+re-request could not be completed via CLI

- **Issue:** GitHub APIs/CLI do not support requesting a GitHub App as a reviewer, and the PR UI did not expose a clear "remove review request" control for the app reviewer.
- **Impact:** The strict "remove then re-request" loop was not fully executed.
- **What was still verified:** `ready_for_review` auto-review and `@claude` mention surfaces (top-level + inline) worked end-to-end.

## Issues Encountered

- `xbmc/xbmc` appears to block pushing arbitrary branches directly; the smoke PR was created from a fork branch.

## User Setup Required

None.

---
*Phase: 13-xbmc-cutover*
*Completed: 2026-02-10*

## Self-Check: PASSED

- FOUND: `.planning/phases/13-xbmc-cutover/13-02-SUMMARY.md`
- VERIFIED: https://github.com/xbmc/xbmc/pull/27834 has a `kodiai[bot]` review and mention replies

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
- Captured smoke-test evidence: `issue_comment` delivery accepted for `xbmc/xbmc` and mention execution completed with `published=true` (test PR: https://github.com/xbmc/xbmc/pull/27832; workflow removal PR: https://github.com/xbmc/xbmc/pull/27833).
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

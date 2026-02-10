---
phase: 13-xbmc-cutover
plan: 02
subsystem: ops
tags: [github, xbmc, cutover, smoke-test, mentions, workflows]

# Dependency graph
requires:
  - phase: 13-xbmc-cutover
    provides: Kodiai GitHub App installed on xbmc/xbmc and webhook deliveries verified
provides:
  - Legacy Claude GitHub Actions workflows removed/disabled on xbmc/xbmc
  - Verified Kodiai parity for ready_for_review + @claude mention surfaces
affects: [ops, rollout, github]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Use a doc-only draft PR to smoke-test ready_for_review + mention surfaces safely"

key-files:
  created: []
  modified: []

key-decisions:
  - "Treat review_requested remove+re-request as UI-only verification: GitHub APIs do not allow requesting a GitHub App as a reviewer from CLI."

patterns-established: []

# Metrics
duration: 10 min
completed: 2026-02-10
---

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

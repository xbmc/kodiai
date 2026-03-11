---
id: T02
parent: S11
milestone: M002
provides:
  - Documented end-to-end smoke procedure for xbmc/xbmc write-mode
  - Runbook snippet for grepping evidence bundle logs by deliveryId
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 10 min
verification_result: passed
completed_at: 2026-02-10
blocker_discovered: false
---
# T02: 21-polish 02

**# Phase 21 Plan 02: xbmc/xbmc Write-Flow Smoke Test Summary**

## What Happened

# Phase 21 Plan 02: xbmc/xbmc Write-Flow Smoke Test Summary

Prepared a concrete, real-world smoke test procedure for xbmc/kodiai (default) covering the full write flow, plus a runbook snippet showing how to locate evidence bundle logs by `deliveryId`.

## What Changed

- Added an end-to-end smoke test checklist and expected outcomes:
  - `docs/smoke/xbmc-kodiai-write-flow.md`
- Added a short section to the mentions runbook on grepping evidence bundle logs by `deliveryId`:
  - `docs/runbooks/mentions.md`

## Manual Verification (Pending)

Run the steps in `docs/smoke/xbmc-kodiai-write-flow.md` and record:

- Same-repo PR: `outcome=updated-pr-branch`
- Fork PR: `outcome=created-pr` (or `reused-pr` on rerun)
- Guardrails: refusal includes rule + file/path + detector when applicable
- Logs: evidence bundle line is easy to locate by `deliveryId`

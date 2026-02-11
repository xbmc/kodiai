---
phase: 21-polish
plan: 02
subsystem: write-mode
tags: [smoke-test, docs, ops]

# Dependency graph
requires:
  - phase: 21-polish
    provides: baseline polish changes (CI strictness + rereview command)
provides:
  - Documented end-to-end smoke procedure for xbmc/xbmc write-mode
  - Runbook snippet for grepping evidence bundle logs by deliveryId
affects: [docs, ops]

# Metrics
duration: 10 min
completed: 2026-02-10
---

# Phase 21 Plan 02: xbmc/xbmc Write-Flow Smoke Test Summary

Prepared a concrete, real-world smoke test procedure for xbmc/xbmc covering the full write flow, plus a runbook snippet showing how to locate evidence bundle logs by `deliveryId`.

## What Changed

- Added an end-to-end smoke test checklist and expected outcomes:
  - `docs/smoke/xbmc-xbmc-write-flow.md`
- Added a short section to the mentions runbook on grepping evidence bundle logs by `deliveryId`:
  - `docs/runbooks/mentions.md`

## Manual Verification (Pending)

Run the steps in `docs/smoke/xbmc-xbmc-write-flow.md` and record:

- Same-repo PR: `outcome=updated-pr-branch`
- Fork PR: `outcome=created-pr` (or `reused-pr` on rerun)
- Guardrails: refusal includes rule + file/path + detector when applicable
- Logs: evidence bundle line is easy to locate by `deliveryId`

---
phase: 13-xbmc-cutover
plan: 01
subsystem: infra
tags: [github-app, webhooks, xbmc, runbook]

requires:
  - phase: 12-fork-pr-robustness
    provides: fork-safe PR fetch + mention/review reliability hardening
provides:
  - xbmc/xbmc cutover runbook (app install + webhook + smoke tests)
affects: [ops, rollout, docs]

tech-stack:
  added: []
  patterns:
    - "Runbooks document webhook verification + smoke tests"

key-files:
  created:
    - docs/runbooks/xbmc-cutover.md
  modified: []

key-decisions:
  - "Create checkpoint summary file (not final SUMMARY) so plan completion detection is not affected before human-action gate."

patterns-established: []

duration: 0min
completed: 2026-02-10
---

# Phase 13 Plan 01: xbmc Cutover (Checkpoint) Summary

**Runbook for installing the Kodiai GitHub App on `xbmc/xbmc`, wiring `/webhooks/github`, and running mention/review smoke tests.**

## Performance

- **Status:** Paused at `checkpoint:human-action` (app install + webhook delivery)
- **Completed tasks:** 1/2

## Accomplishments

- Added `docs/runbooks/xbmc-cutover.md` with permissions, webhook semantics, delivery verification steps, and smoke tests.

## Task Commits

1. **Task 1: Write xbmc cutover runbook (install + webhook + smoke tests)** - `8b6f6ccbed` (docs)

## Deviations from Plan

None - task executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Pending checkpoint:

- Install the Kodiai GitHub App on `xbmc/xbmc` and configure webhook deliveries to `/webhooks/github`.

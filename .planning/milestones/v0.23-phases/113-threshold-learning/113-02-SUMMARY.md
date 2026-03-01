---
phase: 113-threshold-learning
plan: 02
one_liner: "Wire threshold-learner into handlers: dynamic threshold via getEffectiveThreshold, observation recording via recordObservation"
subsystem: triage
tags: [bayesian, threshold-learning, handler-wiring, fail-open]
dependency_graph:
  requires: [113-01-threshold-learner-module]
  provides: [threshold-learning-wiring]
  affects: [issue-opened-handler, issue-closed-handler]
tech_stack:
  added: []
  patterns: [fail-open-wiring, structured-threshold-logging, triage-gate]
key_files:
  created: []
  modified:
    - src/handlers/issue-opened.ts
    - src/handlers/issue-opened.test.ts
    - src/handlers/issue-closed.ts
    - src/handlers/issue-closed.test.ts
decisions:
  - "getEffectiveThreshold called with module defaults (minSamples=20, floor=50, ceiling=95) -- no config surface needed yet"
  - "recordObservation gated on triageId !== null to avoid learning from untriaged issues"
  - "Updated existing mock SQL in issue-opened tests to handle triage_threshold_state query (return empty for config fallback)"
metrics:
  duration: "163s"
  completed: "2026-02-28T08:45:29Z"
  tasks: 2
  tests: 29
---

# Phase 113 Plan 02: Threshold Learning Handler Wiring Summary

Wire threshold-learner into issue-opened (dynamic threshold via getEffectiveThreshold with structured logging) and issue-closed (observation recording via recordObservation with triage gate).

## What Was Built

### issue-opened.ts: Dynamic threshold resolution

- Imported `getEffectiveThreshold` from threshold-learner module
- Replaced static `config.triage.duplicateThreshold ?? 75` with dynamic resolution
- Structured log emitted on every threshold resolution with source, value, configThreshold, and Bayesian state (alpha, beta, sampleCount) when source is "learned"
- Fail-open: if `getEffectiveThreshold` throws, falls back to config threshold with warn log
- `findDuplicateCandidates` now receives `effectiveThreshold` instead of hardcoded config value

### issue-closed.ts: Observation recording

- Imported `recordObservation` from threshold-learner module
- Called after successful outcome INSERT, gated on `triageId !== null`
- Only learns from issues Kodiai actually triaged (prevents noise from untriaged closures)
- Not called on delivery-ID dedup (early return before observation point)
- Fail-open: recordObservation failure caught and logged at warn level, does not prevent outcome capture

### Test coverage: 29 tests total (13 issue-opened + 16 issue-closed)

**New issue-opened tests (2):**
- Learned threshold path: verifies triage_threshold_state is queried and comment posted
- Config fallback path: verifies empty threshold state falls back to config, comment still posted

**New issue-closed tests (4):**
- recordObservation called after outcome insert when triageId is not null
- recordObservation NOT called when triageId is null
- recordObservation NOT called on delivery-ID dedup (early return)
- Handler continues when recordObservation fails (fail-open)

**Existing test update:**
- Updated `createMockSql` in issue-opened tests to handle triage_threshold_state SELECT (returns empty for config fallback)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing mock SQL to handle threshold query**
- **Found during:** Task 1 test verification
- **Issue:** Existing `createMockSql` returned `[{ id: 1 }]` for all queries, causing `getEffectiveThreshold` to interpret `undefined` fields as NaN, breaking threshold resolution
- **Fix:** Updated mock to return `[]` for `triage_threshold_state` SELECT queries
- **Files modified:** src/handlers/issue-opened.test.ts
- **Commit:** 0c71e3d7f0

## Requirements Satisfied

- **LEARN-01:** Observation recording wired into live handler flow (issue-closed records after outcome insert)
- **LEARN-04:** Structured logging on threshold resolution (source, value, Bayesian state)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 0c71e3d7f0 | Wire getEffectiveThreshold into issue-opened handler with tests |
| 2 | 83ab6797c9 | Wire recordObservation into issue-closed handler with tests |

## Self-Check: PASSED

All 4 modified files verified on disk. Both commit hashes found in git log.

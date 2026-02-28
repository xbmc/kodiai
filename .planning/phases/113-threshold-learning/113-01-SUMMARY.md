---
phase: 113-threshold-learning
plan: 01
one_liner: "Beta-Binomial threshold learner with atomic UPSERT, sample gate, and [50,95] clamping"
subsystem: triage
tags: [bayesian, threshold-learning, beta-binomial, duplicate-detection]
dependency_graph:
  requires: [112-outcome-capture]
  provides: [threshold-learner-module, triage-threshold-state-table]
  affects: [duplicate-detector]
tech_stack:
  added: []
  patterns: [beta-binomial-updating, atomic-upsert, confusion-matrix-classification]
key_files:
  created:
    - src/db/migrations/018-triage-threshold-state.sql
    - src/db/migrations/018-triage-threshold-state.down.sql
    - src/triage/threshold-learner.ts
    - src/triage/threshold-learner.test.ts
  modified: []
decisions:
  - "Skip TN observations to avoid drowning alpha with non-duplicate-detection signal"
  - "beta_ column name (trailing underscore) avoids SQL reserved word conflicts"
  - "Atomic SQL-side increment via UPSERT prevents read-then-write race conditions"
metrics:
  duration: "114s"
  completed: "2026-02-28T08:40:02Z"
  tasks: 2
  tests: 20
---

# Phase 113 Plan 01: Threshold Learner Foundation Summary

Beta-Binomial threshold learner with atomic UPSERT, 20-sample gate, and [50,95] clamping for per-repo duplicate detection threshold adaptation.

## What Was Built

### Migration 018: triage_threshold_state table
- Per-repo Bayesian state storage with `alpha`, `beta_`, `sample_count` columns
- Uniform prior defaults (alpha=1, beta=1)
- UNIQUE constraint and index on `repo`
- Down migration for rollback

### threshold-learner.ts module

**Pure functions (no DB, no side effects):**
- `classifyOutcome(predicted, confirmed)` -- maps to confusion matrix quadrants (TP/FP/FN/TN)
- `posteriorMean(alpha, beta)` -- Beta distribution posterior mean
- `posteriorToThreshold(alpha, beta, floor, ceiling)` -- converts posterior to clamped threshold

**DB-boundary functions:**
- `recordObservation({sql, repo, predicted, confirmed, logger})` -- atomic UPSERT with SQL-side increment, skips TN observations
- `getEffectiveThreshold({sql, repo, configThreshold, ...})` -- resolves threshold with 20-sample gate and [50,95] clamping

### Test coverage: 20 tests
- 4 classifyOutcome quadrant tests
- 2 posteriorMean tests (uniform prior, strong alpha)
- 5 posteriorToThreshold tests (uniform, high/low accuracy, clamp floor/ceiling)
- 4 recordObservation tests (TN skip, TP/FP/FN atomic increment verification)
- 5 getEffectiveThreshold tests (no rows, below gate, above gate, ceiling clamp, exact boundary)

## Deviations from Plan

None -- plan executed exactly as written.

## Requirements Satisfied

- **LEARN-01:** Per-repo Bayesian state stored in triage_threshold_state
- **LEARN-02:** Config fallback when sample_count < 20
- **LEARN-03:** Threshold clamped to [50, 95] range

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 7c6d2792c6 | Migration 018 for triage_threshold_state table |
| 2 | 7565bff114 | threshold-learner module with 20 passing tests |

## Self-Check: PASSED

All 4 created files verified on disk. Both commit hashes found in git log.

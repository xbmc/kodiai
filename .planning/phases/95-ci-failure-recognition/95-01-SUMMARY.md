---
phase: 95-ci-failure-recognition
plan: 01
status: complete
started: 2026-02-25
completed: 2026-02-25
---

# Plan 95-01: CI Check History Store and Failure Classifier (TDD)

## What Was Built

Database migration, flakiness data store, and pure classification engine for CI check failures.

### RED Phase
Wrote 9 test cases covering: all-pass returns empty, base-branch match (unrelated/high), flaky override (flaky-unrelated/medium), PR-related default (possibly-pr-related/low), mixed scenario with 3 failure types, flaky below 30% threshold, insufficient data (<20 runs), no base results, and null conclusion handling.

### GREEN Phase
Implemented `classifyFailures` with 3-tier priority logic: base-branch match > flaky override > default PR-related. All 9 tests pass.

### REFACTOR
No refactoring needed — implementation is clean and minimal.

## Key Files

### key-files.created
- `src/db/migrations/008-ci-check-history.sql` — ci_check_history table DDL with composite index
- `src/db/migrations/008-ci-check-history.down.sql` — DROP TABLE rollback
- `src/lib/ci-check-store.ts` — recordCheckRuns (bulk insert) + getFlakiness (rolling 20-run window)
- `src/lib/ci-failure-classifier.ts` — classifyFailures with CheckResult, ClassifiedFailure, FlakinessStat types
- `src/lib/ci-failure-classifier.test.ts` — 9 test cases

### key-files.modified
None — all new files.

## Commits
- `feat(95-01): add CI check history store and failure classifier`

## Self-Check: PASSED

- [x] Migration 008 creates ci_check_history with repo, check_name, head_sha, conclusion columns and composite index
- [x] getFlakiness returns rolling-window stats for last 20 runs
- [x] Classifier labels unrelated (high) for base-branch match
- [x] Classifier labels flaky-unrelated (medium) for >30% over 20 runs
- [x] Classifier labels possibly-pr-related (low) as default
- [x] Returns empty array when all checks pass
- [x] All 9 test cases pass

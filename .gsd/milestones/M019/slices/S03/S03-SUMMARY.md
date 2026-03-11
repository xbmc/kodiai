---
id: S03
parent: M019
milestone: M019
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 2026-02-25
blocker_discovered: false
---
# S03: Ci Failure Recognition

**# Plan 95-02: CI Failure Handler and Formatter**

## What Happened

# Plan 95-02: CI Failure Handler and Formatter

## What Was Built

End-to-end CI failure recognition: webhook handler, markdown formatter, and application wiring.

### Task 1: CI failure formatter and handler

**ci-failure-formatter.ts:**
- `formatCISection()` renders classified failures as markdown with summary line and `<details>` per-check breakdown
- `buildCIAnalysisMarker()` generates hidden HTML comment for idempotent comment upsert
- Icon mapping: unrelated -> checkmark, flaky -> warning, pr-related -> x

**ci-failure.ts (handler):**
- Registers on `check_suite.completed` event via eventRouter
- Fetches all check runs for head SHA using paginated Checks API
- Records runs into `ci_check_history` via `recordCheckRuns` for flakiness accumulation
- Fetches last 3 base-branch commits and their check runs (sequential, not parallel)
- Skips annotation when: all checks pass, no PRs in suite (forks), no base-branch data
- Classifies failures via `classifyFailures` from Plan 01
- Upserts CI comment using marker-based find-or-create pattern
- Completely independent of review pipeline (no merge-confidence imports)
- Fail-open: entire handler wrapped in try/catch, errors logged at warn level
- 403 handling for missing `checks:read` permission

### Task 2: Wire into application

- Import `createCIFailureHandler` added to `src/index.ts`
- Registration call placed after `createDepBumpMergeHistoryHandler`
- Passes `eventRouter`, `jobQueue`, `githubApp`, `sql`, `logger`

## Key Files

### key-files.created
- `src/lib/ci-failure-formatter.ts` — Markdown CI section builder
- `src/handlers/ci-failure.ts` — check_suite.completed handler

### key-files.modified
- `src/index.ts` — Handler import and registration

## Commits
- `feat(95-02): add CI failure handler, formatter, and wire into application`

## Self-Check: PASSED

- [x] check_suite.completed fires handler for PRs with failures
- [x] CI section shows summary line with expandable per-check details
- [x] Each check shows base-branch evidence and confidence level
- [x] No CI comment posted when all checks pass
- [x] Annotation skipped when no base-branch check data exists
- [x] Handler independent of review pipeline (no merge-confidence imports)
- [x] Check runs recorded into ci_check_history for flakiness tracking
- [x] Idempotent: marker-based upsert for same SHA re-runs
- [x] Application builds without errors

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

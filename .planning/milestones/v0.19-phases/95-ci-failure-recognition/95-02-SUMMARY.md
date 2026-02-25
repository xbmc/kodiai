---
phase: 95-ci-failure-recognition
plan: 02
status: complete
started: 2026-02-25
completed: 2026-02-25
---

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

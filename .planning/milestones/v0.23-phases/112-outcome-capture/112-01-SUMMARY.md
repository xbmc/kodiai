---
phase: 112-outcome-capture
plan: 01
subsystem: outcome-capture
tags: [webhook, database, feedback-loop, issue-lifecycle]
dependency_graph:
  requires: [016-issue-triage-state]
  provides: [017-issue-outcome-feedback, issue-closed-handler]
  affects: [113-threshold-learning, 114-reaction-tracking]
tech_stack:
  added: []
  patterns: [factory-handler, tagged-template-sql, fail-open]
key_files:
  created:
    - src/db/migrations/017-issue-outcome-feedback.sql
    - src/db/migrations/017-issue-outcome-feedback.down.sql
    - src/handlers/issue-closed.ts
    - src/handlers/issue-closed.test.ts
  modified:
    - src/index.ts
decisions:
  - "Minimal handler deps (eventRouter, sql, logger only) -- no githubApp or issueStore needed"
  - "Handler placed inside issueStore && embeddingProvider gate (logical gate, not technical dependency)"
metrics:
  duration: 170s
  completed: "2026-02-28T02:27:23Z"
  tasks: 3
  tests: 12
  files_created: 4
  files_modified: 1
---

# Phase 112 Plan 01: Outcome Capture -- Migration, Handler, and Wiring Summary

Issue-closed webhook handler with outcome classification (completed/not_planned/duplicate/unknown), triage linkage via nullable FK, delivery-ID idempotency, and PR filtering.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Migration 017 for outcome feedback table | 1697ff340a | 017-issue-outcome-feedback.sql, .down.sql |
| 2 | Issue-closed handler with tests | 1ea92fdfa2 | issue-closed.ts, issue-closed.test.ts |
| 3 | Wire handler in index.ts | 9920b22664 | src/index.ts |

## What Was Built

### Migration 017
- `issue_outcome_feedback` table with outcome classification, triage linkage, duplicate tracking, and delivery-ID idempotency
- `comment_github_id` column added to `issue_triage_state` for Phase 114 reaction tracking
- Indexes on `repo` and `triage_id` (partial, WHERE NOT NULL)
- Down migration drops table and column

### Issue-Closed Handler
- Factory pattern (`createIssueClosedHandler`) matching project conventions
- PR closure filtering at handler top before any DB queries
- Outcome classification: `state_reason` primary, exact `"duplicate"` label fallback
- Triage linkage via `SELECT` on `issue_triage_state`, nullable `triage_id` FK
- `kodiai_predicted_duplicate` derived from `duplicate_count > 0`
- `ON CONFLICT (delivery_id) DO NOTHING` for idempotent inserts
- Fail-open error handling (try/catch, log, swallow)

### Tests (12 passing)
1. Registers on issues.closed event
2. Skips PR closure events
3. Records completed outcome from state_reason
4. Records duplicate outcome from state_reason
5. Records duplicate from label fallback (state_reason null)
6. Records unknown outcome (no state_reason, no duplicate label)
7. Does not treat possible-duplicate label as confirmed duplicate
8. Links to triage record when one exists
9. Sets triage_id null when no triage record
10. Skips insert on delivery-ID conflict
11. Fails open on handler error
12. Skips events with missing payload fields

### Wiring
- Import added adjacent to `createIssueOpenedHandler`
- Handler called inside `if (issueStore && embeddingProvider)` block with minimal deps

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Minimal handler deps:** Only `eventRouter`, `sql`, `logger` needed -- no GitHub API calls required for outcome capture
2. **Logical gate placement:** Handler placed inside `issueStore && embeddingProvider` block because outcome capture is only meaningful when auto-triage is active

## Verification Results

| Check | Result |
|-------|--------|
| Migration files exist | PASS |
| All 12 tests pass | PASS |
| issue-closed.ts compiles clean | PASS |
| index.ts compiles clean | PASS |
| createIssueClosedHandler in index.ts | PASS |
| ON CONFLICT DO NOTHING in handler | PASS |
| PR filtering (issue.pull_request) | PASS |
| Exact "duplicate" label match | PASS |

## Self-Check: PASSED

All 5 created files verified on disk. All 3 task commits verified in git history.

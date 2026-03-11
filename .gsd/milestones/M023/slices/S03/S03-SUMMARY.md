---
id: S03
parent: M023
milestone: M023
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
completed_at: 
blocker_discovered: false
---
# S03: Outcome Capture

**# Phase 112 Plan 02: Comment GitHub ID Capture Summary**

## What Happened

# Phase 112 Plan 02: Comment GitHub ID Capture Summary

Capture GitHub comment ID from createComment response and store in issue_triage_state.comment_github_id for Phase 114 reaction polling.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Capture triage comment GitHub ID in issue-opened handler | a6abe37180 | src/handlers/issue-opened.ts |
| 2 | Add tests for comment GitHub ID capture | 1ca60e4abd | src/handlers/issue-opened.test.ts |

## What Was Built

### Comment GitHub ID Capture (issue-opened.ts)
- `createComment` return value stored in `commentResponse` variable
- New step 8b: UPDATE `issue_triage_state.comment_github_id` after comment post, before label application
- Wrapped in try/catch for fail-open behavior (warn level, does not throw)
- Targets correct row via `repo` + `issue_number` composite key

### Tests (2 new, 11 total passing)
1. **stores comment GitHub ID after posting triage comment** -- verifies SQL UPDATE includes `comment_github_id` with correct value (99887766) from mock createComment response
2. **continues when comment GitHub ID storage fails (fail-open)** -- verifies label application still occurs even when comment_github_id UPDATE throws

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Non-fatal warn on failure:** comment_github_id storage failure logs at warn level (not error) consistent with fail-open philosophy -- reaction tracking is supplementary, not critical path

## Verification Results

| Check | Result |
|-------|--------|
| issue-opened.ts compiles clean | PASS |
| All 11 tests pass (9 existing + 2 new) | PASS |
| comment_github_id appears in issue-opened.ts | PASS |
| commentResponse.data.id in issue-opened.ts | PASS |
| UPDATE wrapped in try/catch | PASS |

## Self-Check: PASSED

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

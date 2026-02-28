---
phase: 112-outcome-capture
plan: 02
subsystem: outcome-capture
tags: [webhook, triage, reaction-tracking, fail-open]
dependency_graph:
  requires: [112-01, 017-issue-outcome-feedback]
  provides: [comment-github-id-capture]
  affects: [114-reaction-tracking]
tech_stack:
  added: []
  patterns: [fail-open, tagged-template-sql]
key_files:
  created: []
  modified:
    - src/handlers/issue-opened.ts
    - src/handlers/issue-opened.test.ts
decisions:
  - "Non-fatal warn on comment_github_id storage failure -- fail-open philosophy"
metrics:
  duration: 83s
  completed: "2026-02-28T02:31:32Z"
  tasks: 2
  tests: 11
  files_created: 0
  files_modified: 2
---

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

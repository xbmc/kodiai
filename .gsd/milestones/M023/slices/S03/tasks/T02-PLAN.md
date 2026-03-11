# T02: 112-outcome-capture 02

**Slice:** S03 — **Milestone:** M023

## Description

Capture the GitHub comment ID when a triage comment is posted, storing it in `issue_triage_state.comment_github_id` for future reaction tracking.

Purpose: Phase 114's reaction sync job needs the comment GitHub ID to poll reactions on triage comments. Without this, there is no way to map triage records to their posted comments.

Output: Modified `src/handlers/issue-opened.ts` with comment ID capture, and a new test in `src/handlers/issue-opened.test.ts`.

## Must-Haves

- [ ] "After posting a triage comment, the comment's GitHub ID is stored in issue_triage_state.comment_github_id"
- [ ] "Failure to store comment_github_id does not prevent triage from completing (non-fatal warn)"
- [ ] "The UPDATE targets the correct row via repo + issue_number"

## Files

- `src/handlers/issue-opened.ts`
- `src/handlers/issue-opened.test.ts`

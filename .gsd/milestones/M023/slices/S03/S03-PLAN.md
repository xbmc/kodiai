# S03: Outcome Capture

**Goal:** Create the database migration for outcome capture, implement the issue-closed webhook handler with outcome classification and triage linkage, and wire it into the application.
**Demo:** Create the database migration for outcome capture, implement the issue-closed webhook handler with outcome classification and triage linkage, and wire it into the application.

## Must-Haves


## Tasks

- [x] **T01: 112-outcome-capture 01**
  - Create the database migration for outcome capture, implement the issue-closed webhook handler with outcome classification and triage linkage, and wire it into the application.

Purpose: Closes the feedback loop by recording how issues are resolved. The outcome data feeds into Phase 113's Beta-Binomial threshold learning and Phase 114's reaction tracking. Without outcome capture, auto-triage has no signal to learn from.

Output: Migration 017, `src/handlers/issue-closed.ts` with factory, tests, and wiring in `src/index.ts`.
- [x] **T02: 112-outcome-capture 02**
  - Capture the GitHub comment ID when a triage comment is posted, storing it in `issue_triage_state.comment_github_id` for future reaction tracking.

Purpose: Phase 114's reaction sync job needs the comment GitHub ID to poll reactions on triage comments. Without this, there is no way to map triage records to their posted comments.

Output: Modified `src/handlers/issue-opened.ts` with comment ID capture, and a new test in `src/handlers/issue-opened.test.ts`.

## Files Likely Touched

- `src/db/migrations/017-issue-outcome-feedback.sql`
- `src/db/migrations/017-issue-outcome-feedback.down.sql`
- `src/handlers/issue-closed.ts`
- `src/handlers/issue-closed.test.ts`
- `src/index.ts`
- `src/handlers/issue-opened.ts`
- `src/handlers/issue-opened.test.ts`

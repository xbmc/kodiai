# S02: Duplicate Detection Auto Triage

**Goal:** Create the duplicate detection foundation: DB migration for triage state tracking, config schema extension with new auto-triage fields, pure duplicate detection function, and triage comment formatter.
**Demo:** Create the duplicate detection foundation: DB migration for triage state tracking, config schema extension with new auto-triage fields, pure duplicate detection function, and triage comment formatter.

## Must-Haves


## Tasks

- [x] **T01: 107-duplicate-detection-auto-triage 01** `est:5min`
  - Create the duplicate detection foundation: DB migration for triage state tracking, config schema extension with new auto-triage fields, pure duplicate detection function, and triage comment formatter.

Purpose: Provide all the building blocks that the issue-opened handler (Plan 02) will wire together. By isolating pure logic here, Plan 02 focuses entirely on handler wiring and idempotency.

Output: Migration file, extended config schema, tested duplicate-detector module, tested triage-comment module.
- [x] **T02: 107-duplicate-detection-auto-triage 02** `est:8min`
  - Wire the issue-opened handler that triggers auto-triage with duplicate detection on `issues.opened` webhook events. Implements three-layer idempotency, config gating, and registers the handler in the application bootstrap.

Purpose: This is the runtime entry point that connects all Phase 107 building blocks -- the handler listens for `issues.opened`, checks config, claims the issue atomically in the DB, runs duplicate detection, posts a comment, and applies a label.

Output: Tested handler factory, updated index.ts with handler registration.

## Files Likely Touched

- `src/db/migrations/016-issue-triage-state.sql`
- `src/execution/config.ts`
- `src/triage/duplicate-detector.ts`
- `src/triage/duplicate-detector.test.ts`
- `src/triage/triage-comment.ts`
- `src/triage/triage-comment.test.ts`
- `src/handlers/issue-opened.ts`
- `src/handlers/issue-opened.test.ts`
- `src/index.ts`

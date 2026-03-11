# T02: 107-duplicate-detection-auto-triage 02

**Slice:** S02 — **Milestone:** M022

## Description

Wire the issue-opened handler that triggers auto-triage with duplicate detection on `issues.opened` webhook events. Implements three-layer idempotency, config gating, and registers the handler in the application bootstrap.

Purpose: This is the runtime entry point that connects all Phase 107 building blocks -- the handler listens for `issues.opened`, checks config, claims the issue atomically in the DB, runs duplicate detection, posts a comment, and applies a label.

Output: Tested handler factory, updated index.ts with handler registration.

## Must-Haves

- [ ] "When issues.opened webhook fires and autoTriageOnOpen is enabled, the handler embeds the issue, searches for duplicates, and posts a triage comment"
- [ ] "If autoTriageOnOpen is false (default), the handler exits early without processing"
- [ ] "Duplicate triage comments include top candidates from Plan 01's duplicate detector"
- [ ] "If the issue was already triaged (DB flag set), the handler exits without posting a duplicate comment"
- [ ] "If concurrent webhooks race on the same issue, only one succeeds via atomic DB INSERT ... ON CONFLICT DO NOTHING"
- [ ] "The handler applies the configured duplicate label when candidates are found; if the label API fails, it logs a warning and continues"
- [ ] "If no candidates meet the threshold, no comment is posted (zero noise)"

## Files

- `src/handlers/issue-opened.ts`
- `src/handlers/issue-opened.test.ts`
- `src/index.ts`

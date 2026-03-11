# T01: 112-outcome-capture 01

**Slice:** S03 — **Milestone:** M023

## Description

Create the database migration for outcome capture, implement the issue-closed webhook handler with outcome classification and triage linkage, and wire it into the application.

Purpose: Closes the feedback loop by recording how issues are resolved. The outcome data feeds into Phase 113's Beta-Binomial threshold learning and Phase 114's reaction tracking. Without outcome capture, auto-triage has no signal to learn from.

Output: Migration 017, `src/handlers/issue-closed.ts` with factory, tests, and wiring in `src/index.ts`.

## Must-Haves

- [ ] "When an issue is closed, a record is inserted into issue_outcome_feedback with the correct outcome classification"
- [ ] "Pull request closure events are silently filtered out (no outcome record created)"
- [ ] "Duplicate closures are detected from state_reason=duplicate OR exact-match 'duplicate' label (not 'possible-duplicate')"
- [ ] "Outcome records link to the original triage record via triage_id FK when one exists"
- [ ] "Redelivered webhooks with the same delivery ID produce no duplicate rows (ON CONFLICT DO NOTHING)"
- [ ] "Handler fails open -- errors are logged but do not propagate"

## Files

- `src/db/migrations/017-issue-outcome-feedback.sql`
- `src/db/migrations/017-issue-outcome-feedback.down.sql`
- `src/handlers/issue-closed.ts`
- `src/handlers/issue-closed.test.ts`
- `src/index.ts`

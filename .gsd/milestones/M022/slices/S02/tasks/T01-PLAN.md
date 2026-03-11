# T01: 107-duplicate-detection-auto-triage 01

**Slice:** S02 — **Milestone:** M022

## Description

Create the duplicate detection foundation: DB migration for triage state tracking, config schema extension with new auto-triage fields, pure duplicate detection function, and triage comment formatter.

Purpose: Provide all the building blocks that the issue-opened handler (Plan 02) will wire together. By isolating pure logic here, Plan 02 focuses entirely on handler wiring and idempotency.

Output: Migration file, extended config schema, tested duplicate-detector module, tested triage-comment module.

## Must-Haves

- [ ] "Duplicate detection queries the issue corpus for vector-similar candidates above a configurable threshold"
- [ ] "Top duplicate candidates are formatted as a compact markdown table with issue number, title, similarity percentage, and open/closed status"
- [ ] "Duplicate detection never auto-closes issues -- it only produces a comment body and label name"
- [ ] "If embedding generation or vector search fails, duplicate detection returns empty candidates (fail-open)"
- [ ] "Closed candidates are sorted before open ones, and if all candidates are closed a note is appended"
- [ ] "Config schema includes autoTriageOnOpen, duplicateThreshold, maxDuplicateCandidates, duplicateLabel, cooldownMinutes"

## Files

- `src/db/migrations/016-issue-triage-state.sql`
- `src/execution/config.ts`
- `src/triage/duplicate-detector.ts`
- `src/triage/duplicate-detector.test.ts`
- `src/triage/triage-comment.ts`
- `src/triage/triage-comment.test.ts`

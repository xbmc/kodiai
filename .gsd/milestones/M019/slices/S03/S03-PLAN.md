# S03: Ci Failure Recognition

**Goal:** Create the CI check history database table, flakiness store module, and pure classification logic for comparing PR check failures against base-branch results.
**Demo:** Create the CI check history database table, flakiness store module, and pure classification logic for comparing PR check failures against base-branch results.

## Must-Haves


## Tasks

- [x] **T01: 95-ci-failure-recognition 01**
  - Create the CI check history database table, flakiness store module, and pure classification logic for comparing PR check failures against base-branch results.

Purpose: Provides the deterministic classification engine (unrelated / flaky-unrelated / possibly-pr-related) that the handler (Plan 02) will invoke. TDD approach ensures correctness of classification edge cases.
Output: Migration 008, ci-check-store.ts, ci-failure-classifier.ts with tests
- [x] **T02: 95-ci-failure-recognition 02**
  - Build the check_suite.completed webhook handler, CI section formatter, and wire everything into the application. The handler fetches check runs for the PR head SHA and base-branch commits, classifies failures using the classifier from Plan 01, formats a markdown section, and posts/updates a CI annotation comment on the PR.

Purpose: Completes the CI failure recognition feature end-to-end — from webhook event to visible PR annotation.
Output: ci-failure-formatter.ts, ci-failure.ts handler, updated index.ts

## Files Likely Touched

- `src/db/migrations/008-ci-check-history.sql`
- `src/db/migrations/008-ci-check-history.down.sql`
- `src/lib/ci-check-store.ts`
- `src/lib/ci-failure-classifier.ts`
- `src/lib/ci-failure-classifier.test.ts`
- `src/lib/ci-failure-formatter.ts`
- `src/handlers/ci-failure.ts`
- `src/index.ts`

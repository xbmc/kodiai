# T01: 95-ci-failure-recognition 01

**Slice:** S03 — **Milestone:** M019

## Description

Create the CI check history database table, flakiness store module, and pure classification logic for comparing PR check failures against base-branch results.

Purpose: Provides the deterministic classification engine (unrelated / flaky-unrelated / possibly-pr-related) that the handler (Plan 02) will invoke. TDD approach ensures correctness of classification edge cases.
Output: Migration 008, ci-check-store.ts, ci-failure-classifier.ts with tests

## Must-Haves

- [ ] "CI check history table exists with repo, check_name, head_sha, conclusion columns and a composite index"
- [ ] "Flakiness query returns rolling-window stats (failures/total) for the last 20 runs per check name per repo"
- [ ] "Classifier labels a failure as 'unrelated' (high confidence) when the same check name also fails on a base-branch commit"
- [ ] "Classifier labels a failure as 'flaky-unrelated' (medium confidence) when its flakiness rate exceeds 30% over 20 runs"
- [ ] "Classifier labels a failure as 'possibly-pr-related' (low confidence) by default when it passes on base and is not flaky"
- [ ] "Classifier returns empty array when all checks pass (no failures to classify)"

## Files

- `src/db/migrations/008-ci-check-history.sql`
- `src/db/migrations/008-ci-check-history.down.sql`
- `src/lib/ci-check-store.ts`
- `src/lib/ci-failure-classifier.ts`
- `src/lib/ci-failure-classifier.test.ts`

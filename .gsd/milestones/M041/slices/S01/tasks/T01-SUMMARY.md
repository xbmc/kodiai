---
id: T01
parent: S01
milestone: M041
key_files:
  - src/db/migrations/033-canonical-code-corpus.sql
  - src/knowledge/canonical-code-types.ts
  - src/knowledge/canonical-code-store.ts
  - src/knowledge/canonical-code-store.test.ts
  - .gsd/milestones/M041/slices/S01/tasks/T01-SUMMARY.md
key_decisions:
  - Keep canonical current-code storage in dedicated canonical_code_chunks/canonical_corpus_backfill_state tables instead of reusing historical code_snippets tables.
  - Use SQL CHECK constraints to enforce documented canonical chunk_type and backfill status invariants at the schema boundary.
duration: 
verification_result: passed
completed_at: 2026-04-05T14:00:53.946Z
blocker_discovered: false
---

# T01: Validated and tightened the canonical code corpus schema and store contract, including SQL-enforced chunk/backfill invariants and passing store/type verification.

**Validated and tightened the canonical code corpus schema and store contract, including SQL-enforced chunk/backfill invariants and passing store/type verification.**

## What Happened

Verified that the planned canonical corpus artifacts already existed locally: a dedicated migration, explicit canonical chunk/backfill types, a separate canonical code store, and focused store tests. Read the task inputs and canonical files to confirm they matched the slice contract of keeping current-code storage separate from historical diff-hunk snippet storage. Found one contract gap in src/db/migrations/033-canonical-code-corpus.sql: documented chunk_type and backfill status enums were described in comments and reflected in TypeScript types but were not enforced by SQL. Updated the migration to add CHECK constraints for canonical chunk types (function, class, method, module, block) and backfill statuses (running, completed, failed, partial). Then ran the task verification commands; the canonical store test suite passed in full and the workspace TypeScript check passed with no errors.

## Verification

Ran the task-defined verification commands exactly: bun test ./src/knowledge/canonical-code-store.test.ts and bun run tsc --noEmit. The canonical store tests passed 34/34, covering insertion, dedup, replacement, vector/full-text search, stale-row handling, backfill state persistence, and negative/boundary cases. The full TypeScript typecheck passed with no errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/canonical-code-store.test.ts` | 0 | ✅ pass | 17ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6817ms |

## Deviations

None. The planned artifacts were already present locally, so execution became a contract-validation and schema-hardening pass rather than initial file creation.

## Known Issues

None.

## Files Created/Modified

- `src/db/migrations/033-canonical-code-corpus.sql`
- `src/knowledge/canonical-code-types.ts`
- `src/knowledge/canonical-code-store.ts`
- `src/knowledge/canonical-code-store.test.ts`
- `.gsd/milestones/M041/slices/S01/tasks/T01-SUMMARY.md`

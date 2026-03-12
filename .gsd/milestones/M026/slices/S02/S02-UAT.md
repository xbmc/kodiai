# S02: TypeScript Fixes & Code Quality — UAT

**Milestone:** M026
**Written:** 2026-03-11

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: All changes are type-level fixes, logging-level replacements, and module-level refactoring with no runtime behavior changes. Compiler and test suite are the authoritative verification surfaces.

## Preconditions

- Repository cloned and dependencies installed (`bun install`)
- No Postgres/DATABASE_URL required (DB tests skip gracefully)

## Smoke Test

Run `bunx tsc --noEmit && bun test` — both must exit 0.

## Test Cases

### 1. TypeScript strict compilation passes

1. Run `bunx tsc --noEmit`
2. **Expected:** Exit code 0, no error output

### 2. Test suite passes with zero failures

1. Run `bun test`
2. **Expected:** 2181+ pass, 45 skip, 0 fail

### 3. DB tests skip without Postgres

1. Ensure `TEST_DATABASE_URL` is not set
2. Run `bun test src/knowledge/issue-store.test.ts`
3. **Expected:** All tests show as skipped, 0 failures

### 4. No console.log in targeted production files

1. Run `grep -c 'console\.\(log\|warn\|error\)' src/execution/mcp/comment-server.ts src/execution/mention-context.ts src/knowledge/wiki-popularity-backfill.ts src/knowledge/wiki-publisher.ts src/lib/guardrail/audit-store.ts src/llm/pricing.ts src/scripts/backfill-language.ts`
2. **Expected:** 0 for every file

### 5. Helper extraction files exist and are imported

1. Run `test -f src/lib/review-utils.ts && test -f src/lib/mention-utils.ts && echo ok`
2. **Expected:** `ok`
3. Run `grep -c 'from.*review-utils' src/handlers/review.ts`
4. **Expected:** ≥1
5. Run `grep -c 'from.*mention-utils' src/handlers/mention.ts`
6. **Expected:** ≥1

### 6. God files reduced in size

1. Run `wc -l src/handlers/review.ts src/handlers/mention.ts`
2. **Expected:** review.ts ≤ 4100 lines (was 4416), mention.ts ≤ 2600 lines (was 2677)

## Edge Cases

### DB tests with TEST_DATABASE_URL set

1. Set `TEST_DATABASE_URL` to a valid Postgres connection
2. Run `bun test src/knowledge/issue-store.test.ts`
3. **Expected:** Tests execute against DB (not skipped)

### Console.log in excluded files still allowed

1. Run `grep -c 'console\.' src/db/migrate.ts src/config.ts src/index.ts`
2. **Expected:** Non-zero counts (these files are excluded from the pino migration)

## Failure Signals

- `bunx tsc --noEmit` exits non-zero or produces error lines
- `bun test` shows any failures (not skips)
- `grep` finds console.log/warn/error in targeted production files
- Missing `src/lib/review-utils.ts` or `src/lib/mention-utils.ts`
- Import errors when running handlers that depend on extracted utils

## Requirements Proved By This UAT

- R001 — TypeScript strict compilation passes (test case 1)
- R006 — console.log replaced with pino in production files (test case 4)
- R014 — Pure helper extraction from god files (test cases 5, 6)
- R015 — Test suite passes cleanly with DB skip guards (test cases 2, 3)

## Not Proven By This UAT

- Runtime behavior of pino logging in production (no live deployment tested)
- Correctness of extracted helpers beyond type-checking and existing tests (no new unit tests for review-utils.ts)
- Full handler flow after extraction (no integration or E2E tests run)

## Notes for Tester

- T02's auto-mode summary is a placeholder — the work was completed but the summary file lacks structured detail. The verification results (0 tsc errors, 0 test failures) confirm the work is done.
- The 45 skipped tests are expected: 31 pgvector store tests + 14 other conditional skips.

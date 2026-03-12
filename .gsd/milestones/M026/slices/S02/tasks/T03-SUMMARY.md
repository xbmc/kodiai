---
id: T03
parent: S02
milestone: M026
provides:
  - DB-dependent tests skip gracefully when TEST_DATABASE_URL is unset
  - console.log/warn/error replaced with pino logger in 7 production files
key_files:
  - src/knowledge/issue-store.test.ts
  - src/knowledge/review-comment-store.test.ts
  - src/knowledge/memory-store.test.ts
  - src/execution/mcp/comment-server.ts
  - src/execution/mention-context.ts
  - src/knowledge/wiki-popularity-backfill.ts
  - src/knowledge/wiki-publisher.ts
  - src/lib/guardrail/audit-store.ts
  - src/llm/pricing.ts
  - src/scripts/backfill-language.ts
key_decisions:
  - "Use TEST_DATABASE_URL (not DATABASE_URL) for pgvector test skip guards — DATABASE_URL in .env points to prod, tests need a local test DB"
  - "Optional logger params (logger?: Logger) for functions that previously used console.* — callers opt in without breaking existing call sites"
patterns_established:
  - "pgvector tests: describe.skipIf(!TEST_DB_URL) with TEST_DATABASE_URL env var for test DB connection"
  - "Optional logger injection: add logger?: Logger param to factory/function, use logger?.warn() for fire-and-forget warnings"
  - "Script-level pino: standalone scripts create pino({ name: 'scriptName' }) at module level"
observability_surfaces:
  - All 7 production files now emit structured pino logs instead of console.* — queryable in log aggregation
duration: 1 session
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T03: Make DB tests skip gracefully and replace console.log with pino

**Added TEST_DATABASE_URL skip guards to 3 pgvector test files and replaced all console.log/warn/error with pino logger in 7 production files.**

## What Happened

Two independent cleanups:

1. **DB test skip guards:** Changed 3 pgvector store test files (issue-store, review-comment-store, memory-store) to use `describe.skipIf(!TEST_DB_URL)` with a `TEST_DATABASE_URL` env var. Used `TEST_DATABASE_URL` instead of `DATABASE_URL` because `.env` contains a prod DATABASE_URL while tests need a local test DB. Also updated the hardcoded `connectionString` in each test to use `TEST_DB_URL!` so the connection target is configurable.

2. **console.* → pino replacement:** Replaced all console.log/warn/error calls in 7 production files:
   - `wiki-publisher.ts` — already had logger param, replaced `console.log(dryRunOutput)` with `logger.info()`
   - `mention-context.ts` — added optional `logger?: Logger` to `BuildMentionContextOptions`, replaced 2 `console.warn` with `log?.warn()`
   - `audit-store.ts` — added optional `logger?: Logger` param to `createGuardrailAuditStore`, replaced `console.error` with `logger?.error()`
   - `comment-server.ts` — added optional `logger?: Logger` as last param, replaced 3 `console.warn` with `logger?.warn()`
   - `wiki-popularity-backfill.ts` — already had pino logger, replaced 5 `console.log` calls with structured `logger.info()`
   - `pricing.ts` — added module-level `pino({ name: "pricing" })`, replaced `console.warn` with `logger.warn()`
   - `backfill-language.ts` — already had pino logger, replaced 8 `console.log/error` calls with structured `logger.info/error()`

3. **Test update:** Updated `comment-server.test.ts` to pass a mock logger and assert on `logger.warn()` calls instead of intercepting `console.warn`.

## Verification

- `bunx tsc --noEmit` → 0 errors ✓
- `bun test` → 2181 pass, 45 skip, 0 fail ✓
- `TEST_DATABASE_URL='' bun test src/knowledge/issue-store.test.ts` → 18 skip, 0 fail ✓
- `grep -c 'console\.\(log\|warn\|error\)'` on all 7 targeted files → 0 each ✓

### Slice-level checks (partial — intermediate task):
- `bunx tsc --noEmit` exits 0 ✓
- `bun test` exits with 0 failures ✓
- console.* grep on 7 targeted files → 0 ✓
- `src/lib/review-utils.ts` exists → not yet (T04)
- `src/lib/mention-utils.ts` exists → not yet (T04)

## Diagnostics

- Audit remaining console.* usage: `grep -rn 'console\.' src/ --include='*.ts' | grep -v '.test.' | grep -v 'migrate.ts' | grep -v 'config.ts' | grep -v 'index.ts'`
- Check DB test skip behavior: `TEST_DATABASE_URL='' bun test src/knowledge/issue-store.test.ts`
- Inspect pino output: run any modified script and check JSON log lines

## Deviations

- Used `TEST_DATABASE_URL` instead of `DATABASE_URL` for skip guards — DATABASE_URL in `.env` points to prod and would never be unset, making the guard useless. `TEST_DATABASE_URL` is only set when a local test Postgres is available.
- Updated test connection strings to use the env var instead of hardcoded `localhost:5432`.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/issue-store.test.ts` — added TEST_DATABASE_URL skip guard, use env var for connection
- `src/knowledge/review-comment-store.test.ts` — added TEST_DATABASE_URL skip guard, use env var for connection
- `src/knowledge/memory-store.test.ts` — added TEST_DATABASE_URL skip guard, use env var for connection
- `src/execution/mcp/comment-server.ts` — added optional logger param, replaced 3 console.warn with logger?.warn
- `src/execution/mcp/comment-server.test.ts` — updated test to use mock logger instead of console.warn spy
- `src/execution/mention-context.ts` — added Logger import and optional logger option, replaced 2 console.warn
- `src/knowledge/wiki-popularity-backfill.ts` — replaced 5 console.log with structured logger.info
- `src/knowledge/wiki-publisher.ts` — replaced console.log with logger.info
- `src/lib/guardrail/audit-store.ts` — added optional logger param, replaced console.error
- `src/llm/pricing.ts` — added module-level pino logger, replaced console.warn
- `src/scripts/backfill-language.ts` — replaced 8 console.log/error with logger.info/error

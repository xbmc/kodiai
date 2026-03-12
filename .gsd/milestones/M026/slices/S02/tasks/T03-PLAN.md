---
estimated_steps: 4
estimated_files: 10
---

# T03: Make DB tests skip gracefully and replace console.log with pino

**Slice:** S02 — TypeScript Fixes & Code Quality
**Milestone:** M026

## Description

Two independent cleanups: (1) Add `DATABASE_URL` guards to 3 pgvector store test files so they skip instead of fail when Postgres is unavailable. (2) Replace 22 console.log/warn/error calls with pino logger in 7 production source files. Both are required for R015 (test suite passes cleanly) and R006 (structured logging).

## Steps

1. Add `DATABASE_URL` check to `src/knowledge/issue-store.test.ts`, `src/knowledge/review-comment-store.test.ts`, `src/knowledge/memory-store.test.ts` — use `describe.skipIf(!process.env.DATABASE_URL)` or equivalent `beforeAll` skip pattern
2. Replace console.* with pino in files that already accept a logger parameter: `src/execution/mention-context.ts`, `src/knowledge/wiki-publisher.ts`, `src/lib/guardrail/audit-store.ts`
3. Replace console.* with pino in files that need logger injection or import: `src/execution/mcp/comment-server.ts`, `src/knowledge/wiki-popularity-backfill.ts`, `src/llm/pricing.ts`, `src/scripts/backfill-language.ts`
4. Run full test suite and verify 0 failures and 0 tsc errors

## Must-Haves

- [ ] 3 pgvector test files skip when DATABASE_URL is not set
- [ ] `bun test` reports 0 failures
- [ ] console.log/warn/error removed from all 7 targeted production files
- [ ] Replacement uses pino logger consistent with codebase patterns
- [ ] `bunx tsc --noEmit` still exits 0

## Verification

- `bun test 2>&1 | grep -c 'fail'` in summary line → 0
- `DATABASE_URL='' bun test src/knowledge/issue-store.test.ts 2>&1` → tests skip, no failures
- `grep -c 'console\.\(log\|warn\|error\)' src/execution/mcp/comment-server.ts src/execution/mention-context.ts src/knowledge/wiki-popularity-backfill.ts src/knowledge/wiki-publisher.ts src/lib/guardrail/audit-store.ts src/llm/pricing.ts src/scripts/backfill-language.ts` → 0 for each file
- `bunx tsc --noEmit` → 0 errors

## Observability Impact

- Signals added/changed: console.* calls now flow through pino structured logger (better production observability)
- How a future agent inspects this: `grep -rn 'console\.' src/ --include='*.ts'` to audit remaining console usage
- Failure state exposed: None new

## Inputs

- T01 and T02 completed (zero TS errors)
- DECISIONS.md: "M026: DB-dependent tests should skip gracefully when DATABASE_URL is not set"
- Research constraint: console.* in migrate.ts, config.ts, index.ts is acceptable (pre-logger or process-level)

## Expected Output

- 3 test files modified with DATABASE_URL skip guards
- 7 production files modified — console.* replaced with pino
- `bun test` → 0 failures
- `bunx tsc --noEmit` → 0 errors

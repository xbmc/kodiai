---
id: S02
parent: M026
milestone: M026
provides:
  - Zero TypeScript errors across entire codebase (474 → 0)
  - Zero test failures (DB tests skip gracefully without Postgres)
  - Structured pino logging in all production files (no console.* in targeted files)
  - Pure helper extraction from review.ts and mention.ts into lib modules
requires:
  - slice: S01
    provides: Clean repo state without deprecated files or stale imports
affects:
  - S05
key_files:
  - src/lib/review-utils.ts
  - src/lib/mention-utils.ts
  - src/handlers/review.ts
  - src/handlers/mention.ts
  - src/knowledge/store.ts
  - src/knowledge/wiki-publisher.ts
  - src/triage/template-parser.ts
  - src/lib/guardrail/pipeline.ts
  - src/llm/pricing.ts
key_decisions:
  - "noUncheckedIndexedAccess: use `!` for index access in bounded for-loops, after length guards, and on SQL RETURNING/aggregate results"
  - "Cast `(tx as unknown as Sql)` for postgres.js transaction callbacks per DECISIONS.md pattern"
  - "Use TEST_DATABASE_URL (not DATABASE_URL) for pgvector test skip guards — DATABASE_URL in .env points to prod"
  - "Optional logger injection: add `logger?: Logger` param, use `logger?.warn()` for fire-and-forget warnings"
  - "Pure helper extraction: functions with no closure over handler state → src/lib/*-utils.ts"
  - "Add `partially-grounded` to UpdateSuggestion.groundingStatus union (code produces it, DB accepts it)"
patterns_established:
  - "noUncheckedIndexedAccess: use `!` for index access in bounded loops and after length guards"
  - "pgvector tests: describe.skipIf(!TEST_DB_URL) with TEST_DATABASE_URL env var"
  - "Optional logger injection: add logger?: Logger param with logger?.method() calls"
  - "Script-level pino: standalone scripts create pino({ name: 'scriptName' }) at module level"
  - "Pure helper extraction: move functions with no closure over handler state to src/lib/*-utils.ts"
observability_surfaces:
  - "bunx tsc --noEmit error count (0 expected)"
  - "bun test pass/fail/skip counts"
  - "All 7 targeted production files now emit structured pino logs instead of console.*"
drill_down_paths:
  - .gsd/milestones/M026/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M026/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M026/slices/S02/tasks/T03-SUMMARY.md
  - .gsd/milestones/M026/slices/S02/tasks/T04-SUMMARY.md
duration: 4 tasks across multiple sessions
verification_result: passed
completed_at: 2026-03-11
---

# S02: TypeScript Fixes & Code Quality

**Zero TypeScript errors, zero test failures, structured logging in all production files, and 21 pure helpers extracted from god files into dedicated lib modules.**

## What Happened

Four tasks brought the codebase from 474 TypeScript errors and 3 failing tests to zero errors and zero failures:

**T01 — Production TS errors (145 errors, 33 files):** Fixed all production-code TypeScript errors. Most were TS18048/TS2532 null checks from `noUncheckedIndexedAccess` (~100 errors), resolved with `!` assertions where values are guaranteed by surrounding logic. TS2349 transaction callable issues (12 errors) used `(tx as unknown as Sql)` cast per DECISIONS.md. Also found and fixed a real bug: `processPage()` in wiki-update-generator referenced a closure variable `guardrailAuditStore` that was out of scope — fixed by threading it as a parameter.

**T02 — Test TS errors (329 errors, 33 files):** Fixed all test-file TypeScript errors using `!` assertions on query results, `as unknown as Type` mock casts, added missing `MentionEvent` fixture fields, and changed 3 vitest imports to `bun:test`. T02 initially failed in auto-mode and was recovered manually.

**T03 — DB test skip guards + pino migration:** Added `describe.skipIf(!TEST_DB_URL)` guards to 3 pgvector test files using `TEST_DATABASE_URL` (not `DATABASE_URL` which points to prod). Replaced all `console.log/warn/error` with pino logger in 7 production files using optional logger injection pattern.

**T04 — Pure helper extraction:** Extracted 19 pure functions, 4 type aliases, and 4 constants from `review.ts` (4,416→4,030 lines, −386) into `src/lib/review-utils.ts` (451 lines). Extracted 2 pure functions from `mention.ts` (2,677→2,587 lines, −90) into `src/lib/mention-utils.ts` (106 lines). Updated all 4 downstream import sites.

## Verification

- `bunx tsc --noEmit` → **0 errors** ✅
- `bun test` → **2181 pass, 45 skip, 0 fail** ✅
- `grep -c 'console\.(log|warn|error)'` on 7 targeted files → **0 each** ✅
- `test -f src/lib/review-utils.ts` → **exists** (451 lines) ✅
- `test -f src/lib/mention-utils.ts` → **exists** (106 lines) ✅

## Requirements Advanced

- R001 — TypeScript strict compilation now passes with zero errors (was 474)
- R006 — console.log/warn/error replaced with pino in all 7 targeted production files
- R014 — Pure helper functions extracted from review.ts and mention.ts into dedicated lib modules
- R015 — DB tests skip gracefully when TEST_DATABASE_URL is unset; bun test has 0 failures

## Requirements Validated

- R001 — `bunx tsc --noEmit` exits 0 with zero errors across entire codebase
- R006 — `grep -c 'console\.(log|warn|error)'` returns 0 for all 7 targeted production files
- R014 — `src/lib/review-utils.ts` (451 lines, 19 functions) and `src/lib/mention-utils.ts` (106 lines, 2 functions) exist with passing tests
- R015 — `bun test` → 0 failures; DB tests skip when TEST_DATABASE_URL unset

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- T01 fixed 33 files instead of planned 32 (wiki-update-types.ts also needed a type union update)
- T02 failed in auto-mode and required manual recovery — the blocker placeholder was written but the work was completed
- T03 used `TEST_DATABASE_URL` instead of `DATABASE_URL` for skip guards — `DATABASE_URL` in `.env` points to prod and would never be unset

## Known Limitations

- `review.ts` is still 4,030 lines and `mention.ts` is still 2,587 lines — light extraction reduced them but deep restructuring is deferred to R017
- `!` assertions in production code assume bounded loops and SQL RETURNING guarantees hold — if query semantics change, these could mask null bugs

## Follow-ups

- none

## Files Created/Modified

- `src/lib/review-utils.ts` — new: 19 extracted pure functions, 4 types, 4 constants from review.ts
- `src/lib/mention-utils.ts` — new: 2 extracted pure functions from mention.ts
- `src/handlers/review.ts` — replaced inline definitions with imports (−386 lines)
- `src/handlers/mention.ts` — replaced inline definitions with imports (−90 lines)
- `src/slack/write-runner.ts` — updated import path for buildWritePolicyRefusalMessage
- `src/handlers/mention.test.ts` — updated import for scanLinesForFabricatedContent
- `src/jobs/workspace.test.ts` — updated import for buildWritePolicyRefusalMessage
- `src/knowledge/store.ts` — 32 TS error fixes (tx casts, null assertions)
- `src/knowledge/wiki-publisher.ts` — 25 TS error fixes (null assertions)
- `src/triage/template-parser.ts` — 15 TS error fixes (null assertions on regex/array)
- `src/lib/guardrail/pipeline.ts` — 8 TS error fixes
- `src/execution/review-prompt.ts` — 8 TS error fixes
- `src/knowledge/wiki-update-generator.ts` — guardrailAuditStore param fix, tx casts
- `src/knowledge/wiki-update-types.ts` — added partially-grounded to union
- `src/execution/mcp/comment-server.ts` — console.warn → logger?.warn, index signature
- `src/execution/mention-context.ts` — console.warn → optional logger
- `src/knowledge/wiki-popularity-backfill.ts` — console.log → logger.info
- `src/lib/guardrail/audit-store.ts` — console.error → logger?.error
- `src/llm/pricing.ts` — console.warn → pino logger
- `src/scripts/backfill-language.ts` — console.log/error → logger.info/error
- `src/knowledge/issue-store.test.ts` — TEST_DATABASE_URL skip guard
- `src/knowledge/review-comment-store.test.ts` — TEST_DATABASE_URL skip guard
- `src/knowledge/memory-store.test.ts` — TEST_DATABASE_URL skip guard
- `src/execution/mcp/comment-server.test.ts` — mock logger instead of console.warn spy
- 30+ additional test files with TS error fixes

## Forward Intelligence

### What the next slice should know
- The codebase is now fully type-clean — `bunx tsc --noEmit` exits 0 and all tests pass. Documentation slices (S03–S05) can accurately reference module boundaries and types.
- `src/lib/review-utils.ts` and `src/lib/mention-utils.ts` are new modules that should appear in architecture documentation.

### What's fragile
- The `!` assertions on indexed access rely on the correctness of surrounding loop bounds and SQL query guarantees — changes to query semantics could silently introduce null bugs.
- T02 was recovered from a blocker — its summary is a placeholder. The work was completed but the summary lacks the structured detail of other tasks.

### Authoritative diagnostics
- `bunx tsc --noEmit` — single command verifies entire type surface
- `bun test` — 2181 tests, 45 skips, 0 failures is the baseline

### What assumptions changed
- Assumed DATABASE_URL skip guard for tests — actually needed TEST_DATABASE_URL since DATABASE_URL in .env points to prod
- Assumed 32 production files had errors — actually 33 (wiki-update-types.ts also needed fixing)

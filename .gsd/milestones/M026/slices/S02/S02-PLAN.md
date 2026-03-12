# S02: TypeScript Fixes & Code Quality

**Goal:** Zero TypeScript errors, zero test failures, console.log replaced with pino in production code, and light helper extraction from review.ts/mention.ts.
**Demo:** `bunx tsc --noEmit` exits 0, `bun test` has 0 failures, `grep -rn 'console\.\(log\|warn\|error\)' src/ --include='*.ts' | grep -v '\.test\.' | grep -v 'src/db/migrate.ts' | grep -v 'src/config.ts' | grep -v 'src/index.ts'` returns only acceptable uses.

## Must-Haves

- `bunx tsc --noEmit` exits with zero errors (R001)
- `bun test` has zero failures — DB tests skip when DATABASE_URL unset (R015)
- console.log/warn/error replaced with pino in 7 production source files (R006)
- Pure helper functions extracted from review.ts to `src/lib/review-utils.ts` (R014)
- Extractable pure functions from mention.ts moved to `src/lib/mention-utils.ts` (R014)
- All existing tests continue to pass after every change batch

## Proof Level

- This slice proves: contract
- Real runtime required: no
- Human/UAT required: no

## Verification

- `bunx tsc --noEmit` exits 0 (zero errors)
- `bun test` exits with 0 failures
- `grep -c 'console\.\(log\|warn\|error\)' src/execution/mcp/comment-server.ts src/execution/mention-context.ts src/knowledge/wiki-popularity-backfill.ts src/knowledge/wiki-publisher.ts src/lib/guardrail/audit-store.ts src/llm/pricing.ts src/scripts/backfill-language.ts` returns 0 for each
- `test -f src/lib/review-utils.ts && echo exists` → exists
- `test -f src/lib/mention-utils.ts && echo exists` → exists
- `bun test src/lib/review-utils.test.ts` passes (if test file created)

## Observability / Diagnostics

- Runtime signals: none — all changes are type-level, logging-level, or module-level refactoring
- Inspection surfaces: `bunx tsc --noEmit` error count, `bun test` pass/fail count
- Failure visibility: TypeScript compiler errors are self-describing with file:line:col
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: S01's clean codebase (no deprecated files or stale imports)
- New wiring introduced in this slice: `src/lib/review-utils.ts` and `src/lib/mention-utils.ts` imported from `src/handlers/review.ts` and `src/handlers/mention.ts` respectively; no new runtime behavior
- What remains before the milestone is truly usable end-to-end: S03–S05 documentation slices; this slice completes all code quality requirements

## Tasks

- [x] **T01: Fix TypeScript errors in production code (145 errors, 32 files)** `est:45m`
  - Why: 145 of 474 TS errors are in production source files; fixing these first ensures runtime code is type-safe
  - Files: `src/knowledge/store.ts`, `src/knowledge/wiki-publisher.ts`, `src/triage/template-parser.ts`, `src/lib/guardrail/pipeline.ts`, `src/execution/review-prompt.ts`, `src/handlers/review.ts`, and 26 other production files
  - Do: Fix TS18048/TS2532 with null checks (prefer guards over `!` in production), fix TS2349 tx callable issues with `as Sql` cast per DECISIONS.md, fix TS2345 argument mismatches, fix TS2339 property access errors. Work file-by-file starting with highest-error-count files. Run `bunx tsc --noEmit 2>&1 | grep -v '\.test\.' | grep -c 'error TS'` after each batch.
  - Verify: `bunx tsc --noEmit 2>&1 | grep -v '\.test\.' | grep -v '__test' | grep -c 'error TS'` → 0
  - Done when: Zero TS errors in non-test files; `bun test` still passes with ≤4 failures (pre-existing DB tests)

- [x] **T02: Fix TypeScript errors in test code (329 errors, 33 files)** `est:45m`
  - Why: 329 test-file TS errors remain; `!` assertions and `as` casts are acceptable in test code where values are known
  - Files: `src/telemetry/store.test.ts`, `src/knowledge/store.test.ts`, `src/lib/severity-demoter.test.ts`, `src/handlers/issue-closed.test.ts`, `src/lib/output-filter.test.ts`, `src/execution/mcp/issue-comment-server.test.ts`, and 27 other test files
  - Do: Fix TS2532/TS18048 with `!` assertions on query results. Fix TS2739/TS2740 by adding missing fields to MentionEvent fixtures (`issueBody`, `issueTitle`). Fix TS2352 mock casts with `as unknown as Type`. Change 3 vitest imports to `bun:test` (`hybrid-search.test.ts`, `dedup.test.ts`, `cross-corpus-rrf.test.ts`). Fix TS2322 type assignments.
  - Verify: `bunx tsc --noEmit 2>&1 | grep -c 'error TS'` → 0
  - Done when: `bunx tsc --noEmit` exits 0; `bun test` still passes with ≤4 failures

- [x] **T03: Make DB tests skip gracefully and replace console.log with pino** `est:30m`
  - Why: 3 pgvector store tests fail without DATABASE_URL (R015); 22 console.* calls in 7 production files bypass structured logging (R006)
  - Files: `src/knowledge/issue-store.test.ts`, `src/knowledge/review-comment-store.test.ts`, `src/knowledge/memory-store.test.ts`, `src/execution/mcp/comment-server.ts`, `src/execution/mention-context.ts`, `src/knowledge/wiki-popularity-backfill.ts`, `src/knowledge/wiki-publisher.ts`, `src/lib/guardrail/audit-store.ts`, `src/llm/pricing.ts`, `src/scripts/backfill-language.ts`
  - Do: Add `DATABASE_URL` check in `beforeAll` of 3 pgvector test files — if not set, mark tests as skipped. Replace console.log/warn/error with pino logger in 7 production files (some already accept logger params; others need logger injection or import).
  - Verify: `bun test` → 0 failures (previously failing DB tests now skip); `grep -rn 'console\.\(log\|warn\|error\)' src/ --include='*.ts' | grep -v '\.test\.' | grep -v 'src/db/migrate.ts' | grep -v 'src/config.ts' | grep -v 'src/index.ts'` → 0 hits in targeted files
  - Done when: `bun test` has 0 failures; no console.* in targeted production files

- [x] **T04: Extract pure helpers from review.ts and mention.ts** `est:30m`
  - Why: review.ts (4,415 lines) and mention.ts (2,677 lines) are too large; extracting pure helper functions improves readability without restructuring handler flow (R014)
  - Files: `src/handlers/review.ts`, `src/handlers/mention.ts`, `src/lib/review-utils.ts` (new), `src/lib/mention-utils.ts` (new)
  - Do: Move pure utility functions from review.ts pre-handler section (lines 1–1308) to `src/lib/review-utils.ts`: `fingerprintFindingTitle`, `normalizeSeverity`, `normalizeCategory`, `normalizeSkipPattern`, `splitDiffByFile`, and other functions that take explicit params with no closure. Move `buildWritePolicyRefusalMessage` and `scanLinesForFabricatedContent` from mention.ts to `src/lib/mention-utils.ts`. Update imports in review.ts and mention.ts. Only extract functions that don't close over handler state.
  - Verify: `bun test` → 0 failures; `bunx tsc --noEmit` → 0 errors; `wc -l src/handlers/review.ts` shows meaningful reduction; `test -f src/lib/review-utils.ts` → exists
  - Done when: Both util files exist with extracted functions; all imports updated; all tests pass; tsc clean

## Files Likely Touched

- `src/knowledge/store.ts` — 32 TS errors (null checks)
- `src/knowledge/wiki-publisher.ts` — 25 TS errors (null checks)
- `src/triage/template-parser.ts` — 15 TS errors
- `src/lib/guardrail/pipeline.ts` — 8 TS errors
- `src/execution/review-prompt.ts` — 8 TS errors
- `src/handlers/review.ts` — 5 TS errors + extraction
- `src/handlers/mention.ts` — extraction
- `src/telemetry/store.test.ts` — 68 TS errors
- `src/knowledge/store.test.ts` — 35 TS errors
- `src/lib/severity-demoter.test.ts` — 34 TS errors
- `src/handlers/issue-closed.test.ts` — 32 TS errors
- 20+ other test files with TS errors
- `src/knowledge/issue-store.test.ts` — DB skip guard
- `src/knowledge/review-comment-store.test.ts` — DB skip guard
- `src/knowledge/memory-store.test.ts` — DB skip guard
- 7 production files — console.log → pino
- `src/lib/review-utils.ts` — new (extracted helpers)
- `src/lib/mention-utils.ts` — new (extracted helpers)

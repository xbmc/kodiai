---
estimated_steps: 5
estimated_files: 33
---

# T02: Fix TypeScript errors in test code (329 errors, 33 files)

**Slice:** S02 — TypeScript Fixes & Code Quality
**Milestone:** M026

## Description

Fix all 329 TypeScript errors in test files. Test code is more permissive: `!` non-null assertions and `as` casts are acceptable since test values are known. The work is mechanical but high-volume. Key patterns: TS2532/TS18048 on query results (265 errors — add `!`), TS2739/TS2740 missing fixture fields (22 errors — add `issueBody`/`issueTitle` to MentionEvent fixtures), TS2352 mock casts (19 errors — `as unknown as Type`), TS2307 vitest imports (3 errors — switch to `bun:test`).

Large file count but same repetitive patterns across all files.

## Steps

1. Fix `src/telemetry/store.test.ts` (68 errors) — add `!` assertions on query result access
2. Fix `src/knowledge/store.test.ts` (35 errors) and `src/lib/severity-demoter.test.ts` (34 errors) — same `!` pattern plus any mock cast fixes
3. Fix `src/handlers/issue-closed.test.ts` (32 errors), `src/lib/output-filter.test.ts` (18 errors), `src/execution/mcp/issue-comment-server.test.ts` (18 errors) — `!` assertions and missing fixture fields
4. Change vitest → bun:test imports in `src/knowledge/hybrid-search.test.ts`, `src/knowledge/dedup.test.ts`, `src/knowledge/cross-corpus-rrf.test.ts`
5. Fix remaining 18 test files (1–13 errors each): guardrail tests, knowledge tests, triage tests, mention-context tests, wiki tests, issue-opened tests, issue-backfill tests, retrieval e2e tests

## Must-Haves

- [ ] All TS2532/TS18048 in test files fixed with `!` assertions
- [ ] All MentionEvent fixtures updated with missing `issueBody`/`issueTitle` fields
- [ ] All mock casts fixed with `as unknown as Type` pattern
- [ ] 3 vitest imports changed to `bun:test`
- [ ] `bunx tsc --noEmit` exits 0 (zero total errors)
- [ ] All tests still pass (≤4 pre-existing DB failures)

## Verification

- `bunx tsc --noEmit` exits with code 0
- `bunx tsc --noEmit 2>&1 | grep -c 'error TS'` → 0
- `bun test 2>&1 | tail -3` → 0 additional failures beyond 3-4 DB tests

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: `bunx tsc --noEmit` error count
- Failure state exposed: None

## Inputs

- T01 completed (zero production TS errors)
- S02-RESEARCH.md error taxonomy (test section)
- S02-RESEARCH.md common pitfall: MentionEvent fixtures need `issueBody`/`issueTitle`

## Expected Output

- 33 test files modified
- `bunx tsc --noEmit` → 0 errors total
- All tests pass (minus 3-4 DB tests)

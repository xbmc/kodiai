---
estimated_steps: 5
estimated_files: 32
---

# T01: Fix TypeScript errors in production code (145 errors, 32 files)

**Slice:** S02 — TypeScript Fixes & Code Quality
**Milestone:** M026

## Description

Fix all 145 TypeScript errors in production (non-test) source files. These are concentrated in a few high-error files (`store.ts` 32, `wiki-publisher.ts` 25, `template-parser.ts` 15) with the rest spread across 29 files with 1–8 errors each. The dominant error codes are TS18048/TS2532 (nullable from `noUncheckedIndexedAccess`) and TS2349 (postgres.js `tx` not callable).

This is a large file count but the fixes are mechanical and repetitive — the same patterns apply across all files. Work in batches by error density.

## Steps

1. Fix `src/knowledge/store.ts` (32 errors) — add null checks for query results, cast `tx` as `Sql` in `sql.begin()` callbacks per DECISIONS.md pattern
2. Fix `src/knowledge/wiki-publisher.ts` (25 errors) — null checks on indexed access results
3. Fix `src/triage/template-parser.ts` (15 errors) and remaining triage files (threshold-learner 4, triage-agent 1) — null guards on parsed results
4. Fix `src/lib/guardrail/` files (pipeline 8, adapters 5+4+2) — null checks on classification results
5. Fix remaining production files: `src/execution/review-prompt.ts` (8), `src/handlers/review.ts` (5), `src/handlers/issue-closed.ts` (2), MCP servers (2), knowledge stores (wiki-store 2, review-comment-store 2, wiki-update-generator 4, wiki-voice-analyzer 2), `src/lifecycle/webhook-queue-store.ts` (2), scripts (sync-triage-reactions 4, embedding-comparison 4)

## Must-Haves

- [ ] All TS18048/TS2532 errors fixed with proper null checks (not `!` in production code unless value is guaranteed by surrounding logic)
- [ ] All TS2349 `tx` callable errors fixed with `tx as Sql` cast pattern (per DECISIONS.md)
- [ ] All TS2345 argument type mismatches resolved
- [ ] TS2552 in wiki-update-generator.ts investigated — may indicate a real bug (`guardrailAuditStore` → `createGuardrailAuditStore`)
- [ ] Zero TS errors in non-test files
- [ ] All existing tests still pass (≤4 pre-existing DB failures allowed)

## Verification

- `bunx tsc --noEmit 2>&1 | grep -v '\.test\.' | grep -v '__test' | grep -c 'error TS'` → 0
- `bun test 2>&1 | tail -5` → still shows 2180+ pass, ≤4 fail

## Observability Impact

- Signals added/changed: None — type-level fixes only
- How a future agent inspects this: `bunx tsc --noEmit` error count
- Failure state exposed: None

## Inputs

- S02-RESEARCH.md error taxonomy (production section)
- DECISIONS.md: "TransactionSql uses tx.unsafe() for parameterized queries due to Omit<> stripping call signatures"
- Research pitfall: TS2552 in wiki-update-generator.ts may be a real bug

## Expected Output

- 32 production files modified with type fixes
- `bunx tsc --noEmit 2>&1 | grep -v '\.test\.' | grep -c 'error TS'` → 0
- No runtime behavior changes

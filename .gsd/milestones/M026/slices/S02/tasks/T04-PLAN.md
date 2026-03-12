---
estimated_steps: 5
estimated_files: 5
---

# T04: Extract pure helpers from review.ts and mention.ts

**Slice:** S02 — TypeScript Fixes & Code Quality
**Milestone:** M026

## Description

Extract pure utility functions from the pre-handler section of `review.ts` (4,415 lines) and `mention.ts` (2,677 lines) into dedicated lib modules. Only functions that take explicit parameters and don't close over handler state are candidates. This is light extraction per DECISIONS.md ("M026: Light extraction only for review.ts/mention.ts — pure helper functions moved to lib/, no handler flow restructuring").

## Steps

1. Identify extraction candidates in review.ts — scan lines 1–1308 for functions with no closure over handler deps. Key candidates: `fingerprintFindingTitle`, `normalizeSeverity`, `normalizeCategory`, `normalizeSkipPattern`, `splitDiffByFile`, `classifyFindingDeltas`, `extractReviewFindings`, severity/category normalization helpers
2. Create `src/lib/review-utils.ts` — move identified pure functions with their type imports. Export all moved functions.
3. Identify and extract from mention.ts — `buildWritePolicyRefusalMessage` and `scanLinesForFabricatedContent` are confirmed extractable per research. Create `src/lib/mention-utils.ts`.
4. Update imports in `review.ts` and `mention.ts` to use new lib modules
5. Run full verification: `bun test` → 0 failures, `bunx tsc --noEmit` → 0 errors, confirm line count reduction in handler files

## Must-Haves

- [ ] `src/lib/review-utils.ts` exists with extracted pure functions from review.ts
- [ ] `src/lib/mention-utils.ts` exists with extracted pure functions from mention.ts
- [ ] review.ts imports from `src/lib/review-utils.ts` instead of defining functions inline
- [ ] mention.ts imports from `src/lib/mention-utils.ts` instead of defining functions inline
- [ ] No runtime behavior change — all extractions are pure function moves
- [ ] `bunx tsc --noEmit` → 0 errors
- [ ] `bun test` → 0 failures

## Verification

- `test -f src/lib/review-utils.ts` → exists
- `test -f src/lib/mention-utils.ts` → exists
- `wc -l src/handlers/review.ts` → meaningfully less than 4415
- `wc -l src/handlers/mention.ts` → meaningfully less than 2677
- `bun test` → 0 failures
- `bunx tsc --noEmit` → 0 errors

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: Module structure in `src/lib/` — review-utils.ts and mention-utils.ts are discoverable by naming convention
- Failure state exposed: None

## Inputs

- T01–T03 completed (zero TS errors, zero test failures)
- S02-RESEARCH.md: review.ts has ~28 pre-handler functions (lines 168–1308); mention.ts has 2 extractable functions
- DECISIONS.md: "M026: Light extraction only for review.ts/mention.ts"
- Research pitfall: only extract functions that don't close over handler state

## Expected Output

- `src/lib/review-utils.ts` — new file with extracted pure helper functions
- `src/lib/mention-utils.ts` — new file with 2+ extracted functions
- `src/handlers/review.ts` — reduced line count, imports from review-utils
- `src/handlers/mention.ts` — reduced line count, imports from mention-utils
- All tests pass, tsc clean

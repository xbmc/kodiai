# S02: Degraded Retrieval Contract

**Goal:** Lock RET-06 as a runtime contract by making partial-analysis disclosure deterministic in user-visible degraded review outputs.
**Demo:** Lock RET-06 as a runtime contract by making partial-analysis disclosure deterministic in user-visible degraded review outputs.

## Must-Haves


## Tasks

- [x] **T01: 73-degraded-retrieval-contract 01** `est:3 min`
  - Lock RET-06 as a runtime contract by making partial-analysis disclosure deterministic in user-visible degraded review outputs.

Purpose: Prompt-only instructions are not sufficient for reliability follow-through because model wording can drift; Phase 73 requires the exact sentence to appear on every degraded path.
Output: Review-handler disclosure enforcement plus tests proving exact-sentence presence on degraded executions and no leakage on non-degraded executions.
- [x] **T02: 73-degraded-retrieval-contract 02** `est:5 min`
  - Deliver RET-07 by guaranteeing bounded, well-formed retrieval evidence rendering across degraded review and mention surfaces.

Purpose: Phase 73 requires degraded paths to preserve retrieval usefulness without risking prompt overflow or malformed context sections.
Output: Tightened retrieval rendering contract and regression coverage for review + mention prompt builders, including degraded-path combinations.

## Files Likely Touched

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/handlers/review.test.ts`
- `src/handlers/mention.test.ts`

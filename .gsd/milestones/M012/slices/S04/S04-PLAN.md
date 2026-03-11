# S04: Snippet Anchors Prompt Budgeting

**Goal:** Build the RET-08 utility core with TDD: snippet-anchor extraction plus deterministic budget trimming.
**Demo:** Build the RET-08 utility core with TDD: snippet-anchor extraction plus deterministic budget trimming.

## Must-Haves


## Tasks

- [x] **T01: 69-snippet-anchors-prompt-budgeting 01** `est:2m`
  - Build the RET-08 utility core with TDD: snippet-anchor extraction plus deterministic budget trimming.

Purpose: Phase 69 needs reusable logic that can run in both review and mention flows to produce actionable evidence (`path:line` + snippet) without overflowing prompt budgets.
Output: `src/learning/retrieval-snippets.ts` and `src/learning/retrieval-snippets.test.ts` with RED->GREEN coverage for anchor extraction, budget enforcement, and fail-open behavior.
- [x] **T02: 69-snippet-anchors-prompt-budgeting 02** `est:13m`
  - Integrate RET-08 snippet anchors and strict prompt budgeting into live review and mention pipelines.

Purpose: Complete Phase 69 outcome by making retrieval context more actionable (`path:line` + concise snippet evidence) while guaranteeing prompt-size safety and fail-open behavior across both user-facing surfaces.
Output: Handlers enrich retrieval findings with snippet anchors, prompt builders render anchor-aware context, and regressions lock overflow/fallback behavior.

## Files Likely Touched

- `src/learning/retrieval-snippets.ts`
- `src/learning/retrieval-snippets.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`

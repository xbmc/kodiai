# S04: Author Experience Adaptation

**Goal:** TDD: Implement the deterministic author classification logic and prompt tone section builder.
**Demo:** TDD: Implement the deterministic author classification logic and prompt tone section builder.

## Must-Haves


## Tasks

- [x] **T01: 45-author-experience-adaptation 01** `est:2min`
  - TDD: Implement the deterministic author classification logic and prompt tone section builder.

Purpose: Establish the pure-function core of author experience adaptation with full test coverage before wiring into the review pipeline. Classification maps author_association + optional PR count into three tiers (first-time, regular, core). The prompt section builder emits tier-specific tone directives.

Output: Tested classification module and prompt section builder ready for integration.
- [x] **T02: 45-author-experience-adaptation 02** `est:5min`
  - Wire author classification into the review pipeline: SQLite cache table, handler integration with Search API enrichment, prompt injection, Review Details transparency, and fail-open error handling.

Purpose: Connect the tested classification logic (plan 01) to the live review flow so that PR reviews adapt tone based on author experience level, with aggressive caching to minimize API calls and consistent fail-open semantics.

Output: Fully integrated author experience adaptation visible in review output.

## Files Likely Touched

- `src/lib/author-classifier.ts`
- `src/lib/author-classifier.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/knowledge/store.ts`
- `src/knowledge/types.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`

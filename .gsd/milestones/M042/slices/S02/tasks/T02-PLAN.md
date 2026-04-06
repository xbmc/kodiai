---
estimated_steps: 2
estimated_files: 3
skills_used: []
---

# T02: Prove Review Details and handler outputs stay truthful

Extend deterministic Review Details coverage and reuse the existing captured handler harness to assert that one review run threads the resolved author tier into both user-visible surfaces. The task should verify full rendered prompt/details bodies, not proxy fields, and should stay scoped to the existing `runProfileScenario()`-style seam rather than broad end-to-end orchestration.

If `formatReviewDetailsSummary()` wording is too weak to make the tier obvious, tighten it enough to distinguish default/fallback wording from established/senior truthfulness without changing unrelated review-details structure.

## Inputs

- ``src/lib/review-utils.ts``
- ``src/lib/review-utils.test.ts``
- ``src/handlers/review.test.ts``
- ``src/execution/review-prompt.ts``
- ``src/execution/review-prompt.test.ts``

## Expected Output

- ``src/lib/review-utils.ts``
- ``src/lib/review-utils.test.ts``
- ``src/handlers/review.test.ts``

## Verification

bun test ./src/lib/review-utils.test.ts && bun test ./src/handlers/review.test.ts

## Observability Impact

The captured prompt and deterministic Review Details body in `src/handlers/review.test.ts` become the slice’s main inspection surface for future wording regressions.

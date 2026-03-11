# S05: Merge Confidence Scoring

**Goal:** Create the `computeMergeConfidence` pure function that maps dependency bump signal combinations (semver classification, advisory status, breaking change detection) to a categorical confidence level (high/medium/low) with rationale strings.
**Demo:** Create the `computeMergeConfidence` pure function that maps dependency bump signal combinations (semver classification, advisory status, breaking change detection) to a categorical confidence level (high/medium/low) with rationale strings.

## Must-Haves


## Tasks

- [x] **T01: 55-merge-confidence-scoring 01** `est:2min`
  - Create the `computeMergeConfidence` pure function that maps dependency bump signal combinations (semver classification, advisory status, breaking change detection) to a categorical confidence level (high/medium/low) with rationale strings.

Purpose: CONF-01 requires a composite merge confidence score from semver analysis, advisory status, and breaking change signals. This function is the scoring engine.
Output: `src/lib/merge-confidence.ts` with exported types and function, `src/lib/merge-confidence.test.ts` with full coverage.
- [x] **T02: 55-merge-confidence-scoring 02** `est:2min`
  - Wire merge confidence scoring into the review pipeline: compute confidence after enrichment in `review.ts`, render it prominently in the dep bump prompt section, add verdict integration instructions, and append confidence to silent approval body for dep bump PRs.

Purpose: CONF-02 requires merge confidence displayed prominently in the review summary with supporting rationale. This plan connects the scoring function (plan 55-01) to the review output.
Output: Modified `dep-bump-detector.ts` (type), `review-prompt.ts` (rendering), `review.ts` (wiring + approval body).

## Files Likely Touched

- `src/lib/merge-confidence.ts`
- `src/lib/merge-confidence.test.ts`
- `src/lib/dep-bump-detector.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`

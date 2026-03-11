# T02: 55-merge-confidence-scoring 02

**Slice:** S05 — **Milestone:** M009

## Description

Wire merge confidence scoring into the review pipeline: compute confidence after enrichment in `review.ts`, render it prominently in the dep bump prompt section, add verdict integration instructions, and append confidence to silent approval body for dep bump PRs.

Purpose: CONF-02 requires merge confidence displayed prominently in the review summary with supporting rationale. This plan connects the scoring function (plan 55-01) to the review output.
Output: Modified `dep-bump-detector.ts` (type), `review-prompt.ts` (rendering), `review.ts` (wiring + approval body).

## Must-Haves

- [ ] "Dep bump PRs include merge confidence badge and rationale in the LLM review prompt"
- [ ] "The Verdict section instructions tell the LLM to incorporate merge confidence for dep bump PRs"
- [ ] "Merge confidence is computed after enrichment and before prompt construction in review.ts"
- [ ] "Silent approval body includes confidence line for dep bump PRs"
- [ ] "Non-dep-bump PRs are completely unaffected"

## Files

- `src/lib/dep-bump-detector.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`

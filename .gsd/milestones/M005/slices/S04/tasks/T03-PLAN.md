# T03: 33-explainable-learning-and-delta-reporting 03

**Slice:** S04 — **Milestone:** M005

## Description

Wire delta classification and provenance threading into the review handler so that incremental reviews produce delta-labeled findings in Review Details and retrieval provenance is visible in the published output.

Purpose: Connects the delta classifier (33-01) and extended format functions (33-02) into the live review handler, completing the end-to-end data flow from finding extraction through delta classification to published Review Details with delta + provenance sections.

Output: Modified `src/handlers/review.ts` with delta classification call and provenance threading into `formatReviewDetailsSummary`.

## Must-Haves

- [ ] "Delta classification runs after finding extraction in incremental mode and produces delta-labeled findings"
- [ ] "Delta classification is fail-open: errors degrade to no delta labels rather than blocking review publication"
- [ ] "Provenance data from retrieval context is threaded into formatReviewDetailsSummary as provenanceSummary"
- [ ] "Delta summary data from classifyFindingDeltas is threaded into formatReviewDetailsSummary as deltaSummary"
- [ ] "Dedup-suppressed findings are counted as suppressedStillOpen in the delta summary"
- [ ] "Full (non-incremental) reviews do not show delta summary"

## Files

- `src/handlers/review.ts`

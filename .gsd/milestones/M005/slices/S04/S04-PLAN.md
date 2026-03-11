# S04: Explainable Learning And Delta Reporting

**Goal:** Create a delta classification module that compares current review findings against prior review findings using filePath:titleFingerprint composite keys to label each finding as `new`, `still-open`, or `resolved`.
**Demo:** Create a delta classification module that compares current review findings against prior review findings using filePath:titleFingerprint composite keys to label each finding as `new`, `still-open`, or `resolved`.

## Must-Haves


## Tasks

- [x] **T01: 33-explainable-learning-and-delta-reporting 01** `est:2min`
  - Create a delta classification module that compares current review findings against prior review findings using filePath:titleFingerprint composite keys to label each finding as `new`, `still-open`, or `resolved`.

Purpose: Provides the classification engine that Phase 33-03 will call from the review handler to produce delta-labeled findings for the Review Details summary. This is a pure deterministic set-comparison function with well-defined I/O -- ideal for TDD.

Output: `src/lib/delta-classifier.ts` with exported types and `classifyFindingDeltas` function, plus comprehensive test coverage.
- [x] **T02: 33-explainable-learning-and-delta-reporting 02** `est:3min`
  - Extend the Review Details format to include delta summary and learning provenance sections, and enhance the retrieval context prompt with provenance citation instructions.

Purpose: Builds the formatting layer that renders delta status and provenance data into user-visible Review Details output. Also enriches the LLM prompt to encourage citing prior patterns. This plan modifies the formatting functions (signature extensions) that Plan 33-03 will call with real data from the handler.

Output: Extended `formatReviewDetailsSummary` in review.ts, enhanced `buildRetrievalContextSection` in review-prompt.ts, tests for the prompt enhancement.
- [x] **T03: 33-explainable-learning-and-delta-reporting 03** `est:2min`
  - Wire delta classification and provenance threading into the review handler so that incremental reviews produce delta-labeled findings in Review Details and retrieval provenance is visible in the published output.

Purpose: Connects the delta classifier (33-01) and extended format functions (33-02) into the live review handler, completing the end-to-end data flow from finding extraction through delta classification to published Review Details with delta + provenance sections.

Output: Modified `src/handlers/review.ts` with delta classification call and provenance threading into `formatReviewDetailsSummary`.

## Files Likely Touched

- `src/lib/delta-classifier.ts`
- `src/lib/delta-classifier.test.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`

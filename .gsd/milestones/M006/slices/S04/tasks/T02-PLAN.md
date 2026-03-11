# T02: 33-explainable-learning-and-delta-reporting 02

**Slice:** S04 — **Milestone:** M006

## Description

Extend the Review Details format to include delta summary and learning provenance sections, and enhance the retrieval context prompt with provenance citation instructions.

Purpose: Builds the formatting layer that renders delta status and provenance data into user-visible Review Details output. Also enriches the LLM prompt to encourage citing prior patterns. This plan modifies the formatting functions (signature extensions) that Plan 33-03 will call with real data from the handler.

Output: Extended `formatReviewDetailsSummary` in review.ts, enhanced `buildRetrievalContextSection` in review-prompt.ts, tests for the prompt enhancement.

## Must-Haves

- [ ] "formatReviewDetailsSummary accepts optional delta and provenance parameters and renders them when present"
- [ ] "Delta summary section shows new, resolved, and still-open counts with resolved finding list"
- [ ] "Provenance section lists retrieved memories with relevance labels inside a collapsible details block"
- [ ] "buildRetrievalContextSection includes a provenance citation instruction when retrieval context is non-empty"
- [ ] "Existing Review Details format is preserved when delta and provenance are not provided (backward compatible)"

## Files

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`

# S08: Review Details Embedding

**Goal:** Rewrite formatReviewDetailsSummary() to produce the minimal FORMAT-13 output (4 factual lines), remove buildMetricsInstructions() from the prompt, and modify the handler flow to embed Review Details into the summary comment when one exists.
**Demo:** Rewrite formatReviewDetailsSummary() to produce the minimal FORMAT-13 output (4 factual lines), remove buildMetricsInstructions() from the prompt, and modify the handler flow to embed Review Details into the summary comment when one exists.

## Must-Haves


## Tasks

- [x] **T01: 37-review-details-embedding 01** `est:4min`
  - Rewrite formatReviewDetailsSummary() to produce the minimal FORMAT-13 output (4 factual lines), remove buildMetricsInstructions() from the prompt, and modify the handler flow to embed Review Details into the summary comment when one exists.

Purpose: FORMAT-11 requires Review Details inside the summary comment, FORMAT-12 removes time-saved metrics, FORMAT-13 defines the minimal factual format. This plan implements all three requirements in the production code. FORMAT-11 interpretation: "Never create standalone comment with just Review Details" applies when a summary comment exists. Clean reviews (no findings, no summary posted) are exempted -- standalone Review Details is retained for metrics visibility because there is no summary to embed into.
Output: Updated review.ts with new format + embed/standalone logic, cleaned review-prompt.ts, updated prompt tests.
- [x] **T02: 37-review-details-embedding 02** `est:2min`
  - Update all test assertions to match the new FORMAT-13 Review Details format and add a sanitizer tolerance test confirming the sanitizer accepts summary comments with an appended Review Details block.

Purpose: After Plan 01 changes the production code, existing tests will fail because they assert on the old format. This plan fixes all test assertions and adds coverage for the sanitizer's behavior with the combined comment body.
Output: All tests pass with the new format; sanitizer tolerance verified.

## Files Likely Touched

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.test.ts`
- `src/execution/mcp/comment-server.test.ts`

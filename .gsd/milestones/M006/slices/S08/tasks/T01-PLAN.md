# T01: 37-review-details-embedding 01

**Slice:** S08 — **Milestone:** M006

## Description

Rewrite formatReviewDetailsSummary() to produce the minimal FORMAT-13 output (4 factual lines), remove buildMetricsInstructions() from the prompt, and modify the handler flow to embed Review Details into the summary comment when one exists.

Purpose: FORMAT-11 requires Review Details inside the summary comment, FORMAT-12 removes time-saved metrics, FORMAT-13 defines the minimal factual format. This plan implements all three requirements in the production code. FORMAT-11 interpretation: "Never create standalone comment with just Review Details" applies when a summary comment exists. Clean reviews (no findings, no summary posted) are exempted -- standalone Review Details is retained for metrics visibility because there is no summary to embed into.
Output: Updated review.ts with new format + embed/standalone logic, cleaned review-prompt.ts, updated prompt tests.

## Must-Haves

- [ ] "formatReviewDetailsSummary() produces exactly four data lines: files reviewed, lines changed (+/-), findings by severity, and review timestamp"
- [ ] "No 'Estimated review time saved' or time-saved formula appears in the Review Details output"
- [ ] "buildMetricsInstructions() no longer exists in review-prompt.ts and is not invoked"
- [ ] "When a summary comment was published, Review Details is appended to it instead of posted standalone (FORMAT-11 compliance)"
- [ ] "When no summary comment exists (clean review), Review Details is posted as a standalone comment (FORMAT-11 exemption: clean reviews have no summary to embed into, standalone preserves metrics visibility)"

## Files

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`

# S01: Review Mode Severity Control

**Goal:** Extend the `.
**Demo:** Extend the `.

## Must-Haves


## Tasks

- [x] **T01: 26-review-mode-severity-control 01** `est:2min`
  - Extend the `.kodiai.yml` review config schema with new fields for review mode, severity filtering, focus areas, and comment cap.

Purpose: Enable users to configure review behavior via `.kodiai.yml` without any code changes in their repos. These config values will drive prompt enrichment in Plan 26-02.
Output: Updated `reviewSchema` Zod definition with new optional fields and comprehensive tests.
- [x] **T02: 26-review-mode-severity-control 02** `est:2min`
  - Enrich the review prompt builder with mode-aware instructions for severity classification, focus areas, noise suppression, and comment caps. Wire the new config fields from the handler to the prompt builder.

Purpose: Transform config values into Claude prompt instructions that control review behavior -- all review intelligence lives in the prompt, not in post-processing code.
Output: Updated `buildReviewPrompt()` with conditional prompt sections and updated handler call site.

## Files Likely Touched

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`

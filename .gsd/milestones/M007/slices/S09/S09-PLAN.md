# S09: Delta Re Review Formatting

**Goal:** Add a delta-focused re-review template to the prompt builder that replaces the standard five-section template when incremental re-review data is available, and thread the delta context from review.
**Demo:** Add a delta-focused re-review template to the prompt builder that replaces the standard five-section template when incremental re-review data is available, and thread the delta context from review.

## Must-Haves


## Tasks

- [x] **T01: 38-delta-re-review-formatting 01** `est:3min`
  - Add a delta-focused re-review template to the prompt builder that replaces the standard five-section template when incremental re-review data is available, and thread the delta context from review.ts to the prompt builder.

Purpose: Re-reviews currently use the same five-section template as initial reviews, repeating all findings even when most are unchanged. This plan adds a distinct delta template (What Changed, New Findings, Resolved Findings, Still Open, Verdict Update) that focuses maintainer attention on what actually changed.

Output: `buildReviewPrompt()` conditionally produces the delta template when `deltaContext` is provided; `review.ts` passes hoisted prior findings to the prompt builder; new tests verify both paths.
- [x] **T02: 38-delta-re-review-formatting 02** `est:2min`
  - Add a delta re-review sanitizer that validates the delta template structure (distinct from the initial review five-section sanitizer), with discriminator routing based on the summary tag content.

Purpose: The delta template has different required sections, different verdict format, and no Impact/Preference subsections. The sanitizer must validate these constraints without breaking the existing five-section validator for initial reviews.

Output: `sanitizeKodiaiReReviewSummary()` validates delta template structure; the existing `sanitizeKodiaiReviewSummary()` call chain routes to the correct validator based on `<summary>` tag content; comprehensive tests cover both happy and error paths.

## Files Likely Touched

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`

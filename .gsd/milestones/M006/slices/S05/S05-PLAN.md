# S05: Structured Review Template

**Goal:** Rewrite the standard-mode summary comment prompt and add a reviewed-categories helper

Purpose: Instruct Claude to produce the five-section structured template (What Changed, Strengths, Observations, Suggestions, Verdict) instead of the current issues-only format, and dynamically generate the FORMAT-02 "Reviewed: .
**Demo:** Rewrite the standard-mode summary comment prompt and add a reviewed-categories helper

Purpose: Instruct Claude to produce the five-section structured template (What Changed, Strengths, Observations, Suggestions, Verdict) instead of the current issues-only format, and dynamically generate the FORMAT-02 "Reviewed: .

## Must-Haves


## Tasks

- [x] **T01: 34-structured-review-template 01** `est:3min`
  - Rewrite the standard-mode summary comment prompt and add a reviewed-categories helper

Purpose: Instruct Claude to produce the five-section structured template (What Changed, Strengths, Observations, Suggestions, Verdict) instead of the current issues-only format, and dynamically generate the FORMAT-02 "Reviewed: ..." checklist from diff analysis data.

Output: Updated review-prompt.ts with new template instructions and buildReviewedCategoriesLine() export; updated review-prompt.test.ts with tests for both.
- [x] **T02: 34-structured-review-template 02** `est:4min`
  - Rewrite sanitizeKodiaiReviewSummary() to validate the new five-section template

Purpose: Enforce the structured review template server-side so that malformed or hallucinated section orderings are caught before posting to GitHub. The sanitizer is the safety net that ensures consistent output regardless of prompt compliance.

Output: Updated comment-server.ts with five-section validation logic; comprehensive sanitizer tests in comment-server.test.ts.

## Files Likely Touched

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`

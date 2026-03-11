# S06: Findings Organization And Tone

**Goal:** Rewrite the standard-mode Observations section prompt from severity-only grouping to Impact/Preference subsections with inline severity tags.
**Demo:** Rewrite the standard-mode Observations section prompt from severity-only grouping to Impact/Preference subsections with inline severity tags.

## Must-Haves


## Tasks

- [x] **T01: 35-findings-organization-and-tone 01** `est:3min`
  - Rewrite the standard-mode Observations section prompt from severity-only grouping to Impact/Preference subsections with inline severity tags. Add PR intent scoping instructions, tone/language guidelines, and stabilizing language rules. Thread PR labels from the handler to the prompt builder.

Purpose: Findings are categorized by real impact vs preference, scoped to PR intent, and expressed with specific low-drama language (FORMAT-06, FORMAT-07, FORMAT-08, FORMAT-17, FORMAT-18).
Output: Updated prompt template, handler threading, and comprehensive tests.
- [x] **T02: 35-findings-organization-and-tone 02** `est:4min`
  - Update sanitizeKodiaiReviewSummary() to validate the new Impact/Preference Observations structure with inline severity tags, replacing the Phase 34 severity sub-heading validation.

Purpose: Server-side validation ensures Claude's output follows the Impact/Preference structure with proper severity tags (FORMAT-06, FORMAT-18).
Output: Updated sanitizer and comprehensive tests.

## Files Likely Touched

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`

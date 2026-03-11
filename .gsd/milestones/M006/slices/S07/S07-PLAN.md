# S07: Verdict And Merge Confidence

**Goal:** Rewrite the Verdict section template, add a Verdict Logic prompt section, update the Suggestions section template, and update hard requirements in `buildReviewPrompt()` to deliver explicit merge recommendations driven by blocker counts.
**Demo:** Rewrite the Verdict section template, add a Verdict Logic prompt section, update the Suggestions section template, and update hard requirements in `buildReviewPrompt()` to deliver explicit merge recommendations driven by blocker counts.

## Must-Haves


## Tasks

- [x] **T01: 36-verdict-and-merge-confidence 01** `est:2min`
  - Rewrite the Verdict section template, add a Verdict Logic prompt section, update the Suggestions section template, and update hard requirements in `buildReviewPrompt()` to deliver explicit merge recommendations driven by blocker counts.

Purpose: Replace subjective verdict labels ("Looks good", "Needs changes", "Blocker") with merge-actionable labels ("Ready to merge", "Ready to merge with minor items", "Address before merging") and give Claude deterministic rules for selecting the verdict based on CRITICAL/MAJOR finding counts under ### Impact.
Output: Updated prompt template and comprehensive tests.
- [x] **T02: 36-verdict-and-merge-confidence 02** `est:4min`
  - Add a verdict-observations consistency cross-check to `sanitizeKodiaiReviewSummary()` and update all existing test data to use the new verdict labels from Phase 36.

Purpose: Enforce the core Phase 36 invariant -- a PR with zero CRITICAL/MAJOR findings under ### Impact must never show a :red_circle: verdict. This is the sanitizer-level gate that catches cases where the prompt instructions fail to guide Claude correctly.
Output: Updated sanitizer with cross-check and comprehensive tests.

## Files Likely Touched

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`

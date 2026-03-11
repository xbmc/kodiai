# T02: 36-verdict-and-merge-confidence 02

**Slice:** S07 — **Milestone:** M007

## Description

Add a verdict-observations consistency cross-check to `sanitizeKodiaiReviewSummary()` and update all existing test data to use the new verdict labels from Phase 36.

Purpose: Enforce the core Phase 36 invariant -- a PR with zero CRITICAL/MAJOR findings under ### Impact must never show a :red_circle: verdict. This is the sanitizer-level gate that catches cases where the prompt instructions fail to guide Claude correctly.
Output: Updated sanitizer with cross-check and comprehensive tests.

## Must-Haves

- [ ] "Sanitizer rejects :red_circle: verdict when zero CRITICAL/MAJOR findings exist under ### Impact"
- [ ] "Sanitizer logs warning when :green_circle: verdict used despite CRITICAL/MAJOR findings existing"
- [ ] "All existing test data uses new verdict labels (Ready to merge, Ready to merge with minor items, Address before merging)"
- [ ] "A PR with zero blockers never passes sanitizer with :red_circle: verdict"

## Files

- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`

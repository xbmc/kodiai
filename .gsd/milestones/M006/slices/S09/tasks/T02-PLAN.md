# T02: 38-delta-re-review-formatting 02

**Slice:** S09 — **Milestone:** M006

## Description

Add a delta re-review sanitizer that validates the delta template structure (distinct from the initial review five-section sanitizer), with discriminator routing based on the summary tag content.

Purpose: The delta template has different required sections, different verdict format, and no Impact/Preference subsections. The sanitizer must validate these constraints without breaking the existing five-section validator for initial reviews.

Output: `sanitizeKodiaiReReviewSummary()` validates delta template structure; the existing `sanitizeKodiaiReviewSummary()` call chain routes to the correct validator based on `<summary>` tag content; comprehensive tests cover both happy and error paths.

## Must-Haves

- [ ] "Delta re-review summaries are validated by a dedicated sanitizer that checks delta template structure"
- [ ] "Initial review summaries continue to be validated by the existing five-section sanitizer"
- [ ] "The sanitizer discriminates between initial and delta templates using the <summary> tag content"
- [ ] "Delta sanitizer requires Re-review header, What Changed, and Verdict Update; at least one of New Findings/Resolved Findings/Still Open"
- [ ] "Delta verdict format is validated as ':emoji: **Label** -- explanation' with delta-specific emojis"

## Files

- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`

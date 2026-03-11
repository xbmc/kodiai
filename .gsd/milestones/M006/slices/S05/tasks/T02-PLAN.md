# T02: 34-structured-review-template 02

**Slice:** S05 — **Milestone:** M006

## Description

Rewrite sanitizeKodiaiReviewSummary() to validate the new five-section template

Purpose: Enforce the structured review template server-side so that malformed or hallucinated section orderings are caught before posting to GitHub. The sanitizer is the safety net that ensures consistent output regardless of prompt compliance.

Output: Updated comment-server.ts with five-section validation logic; comprehensive sanitizer tests in comment-server.test.ts.

## Must-Haves

- [ ] "sanitizeKodiaiReviewSummary() validates the five-section template with required sections (What Changed, Observations, Verdict) and optional sections (Strengths, Suggestions)"
- [ ] "Sanitizer enforces section ordering -- sections must appear in the canonical order when present"
- [ ] "Sanitizer validates verdict line format uses one of the three verdict emojis with bold label and explanation"
- [ ] "Valid reviews with all five sections pass sanitization without modification"
- [ ] "Valid reviews with only required sections (no Strengths, no Suggestions) pass sanitization"
- [ ] "Old issues-only format no longer passes validation (severity heading without ## prefix is rejected)"

## Files

- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`

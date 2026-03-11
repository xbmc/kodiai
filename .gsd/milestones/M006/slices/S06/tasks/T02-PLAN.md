# T02: 35-findings-organization-and-tone 02

**Slice:** S06 — **Milestone:** M006

## Description

Update sanitizeKodiaiReviewSummary() to validate the new Impact/Preference Observations structure with inline severity tags, replacing the Phase 34 severity sub-heading validation.

Purpose: Server-side validation ensures Claude's output follows the Impact/Preference structure with proper severity tags (FORMAT-06, FORMAT-18).
Output: Updated sanitizer and comprehensive tests.

## Must-Haves

- [ ] "Sanitizer validates ### Impact and ### Preference subsections under ## Observations instead of ### Critical/Major/Medium/Minor"
- [ ] "Sanitizer validates severity-tagged finding lines: [SEVERITY] path (lines): title format"
- [ ] "### Impact is required in Observations; ### Preference is optional"
- [ ] "CRITICAL or MAJOR findings in Preference trigger a warning log but do not reject the review"
- [ ] "Finding lines without a severity tag prefix are rejected by the sanitizer"

## Files

- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`

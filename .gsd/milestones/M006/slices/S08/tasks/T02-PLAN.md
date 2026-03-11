# T02: 37-review-details-embedding 02

**Slice:** S08 — **Milestone:** M006

## Description

Update all test assertions to match the new FORMAT-13 Review Details format and add a sanitizer tolerance test confirming the sanitizer accepts summary comments with an appended Review Details block.

Purpose: After Plan 01 changes the production code, existing tests will fail because they assert on the old format. This plan fixes all test assertions and adds coverage for the sanitizer's behavior with the combined comment body.
Output: All tests pass with the new format; sanitizer tolerance verified.

## Must-Haves

- [ ] "Review Details test assertions match the new FORMAT-13 output (Lines changed: +N -N, Findings:, Review completed:)"
- [ ] "No test asserts on removed fields (Lines analyzed, Suppressions applied, Estimated review time saved, Low Confidence Findings)"
- [ ] "Sanitizer tolerates a summary comment with Review Details appended after the closing </details> tag"
- [ ] "The 'published false' test validates the standalone Review Details path for clean reviews (FORMAT-11 exemption: no summary exists to embed into)"

## Files

- `src/handlers/review.test.ts`
- `src/execution/mcp/comment-server.test.ts`

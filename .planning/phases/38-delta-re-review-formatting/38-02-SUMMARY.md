---
phase: 38-delta-re-review-formatting
plan: 02
subsystem: review-output
tags: [delta-review, sanitizer, re-review, comment-server, validation]

# Dependency graph
requires:
  - phase: 38-01
    provides: delta template in buildReviewPrompt with Kodiai Re-Review Summary discriminator
  - phase: 34-structured-review-template
    provides: sanitizeKodiaiReviewSummary five-section validator pattern
  - phase: 36-verdict-and-merge-confidence
    provides: verdict-observations cross-check pattern in sanitizer
provides:
  - sanitizeKodiaiReReviewSummary() function validating delta template structure
  - Discriminator chain routing initial vs delta templates via summary tag content
  - 18 comprehensive tests covering happy paths, error paths, and discrimination
affects: [comment validation, re-review output]

# Tech tracking
tech-stack:
  added: []
  patterns: [discriminator-chain-routing, delta-sanitizer-validation]

key-files:
  created: []
  modified:
    - src/execution/mcp/comment-server.ts
    - src/execution/mcp/comment-server.test.ts

key-decisions:
  - "Delta sanitizer validates structure only (sections, verdict format, headings); badges like :new: are prompt-driven not sanitizer-enforced"
  - "Discriminator chain uses passthrough pattern: each sanitizer checks its own summary tag and returns body unchanged if no match"
  - "Forbidden section checks catch initial review sections leaking into delta template (Observations, Strengths, Suggestions, bare Verdict)"

patterns-established:
  - "Discriminator chain: sanitizeReReview(sanitizeReview(sanitizeDecision(body))) where each function has early exit on non-matching content"
  - "Delta heading whitelist with prefix matching for Re-review header that includes SHA suffix"

# Metrics
duration: 2min
completed: 2026-02-13
---

# Phase 38 Plan 02: Delta Re-Review Sanitizer Summary

**sanitizeKodiaiReReviewSummary() with delta template validation, discriminator chain routing, and 18 comprehensive tests covering all validation paths**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T23:41:35Z
- **Completed:** 2026-02-13T23:43:51Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- sanitizeKodiaiReReviewSummary() validates delta template: required sections (Re-review, What Changed, Verdict Update), at least one delta section, no forbidden sections, verdict format with delta emojis, no extra headings
- Discriminator chain wired in both update_comment and create_comment handlers: sanitizeReReview(sanitizeReview(sanitizeDecision(body)))
- 18 tests: 7 happy paths, 9 error paths, 2 discrimination tests confirming initial and delta templates do not interfere
- All 460 tests pass across 25 files with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sanitizeKodiaiReReviewSummary and wire discriminator routing** - `b022f1ee92` (feat)
2. **Task 2: Add comprehensive delta sanitizer tests** - `e629b9adc7` (test)

## Files Created/Modified
- `src/execution/mcp/comment-server.ts` - Added sanitizeKodiaiReReviewSummary() function with delta template validation; wired discriminator chain in both tool handlers
- `src/execution/mcp/comment-server.test.ts` - Added buildTestReReviewSummary() helper and 18 Phase 38 delta sanitizer tests

## Decisions Made
- Delta sanitizer validates structure only (sections, verdict format, headings); badges like :new: and :white_check_mark: are prompt-driven, not sanitizer-enforced -- consistent with initial review sanitizer not validating Strengths badges
- Discriminator chain uses passthrough pattern where each sanitizer checks its own summary tag and returns body unchanged if no match, making the functions composable in any order
- Forbidden section checks explicitly catch initial review sections (Observations, Strengths, Suggestions, bare Verdict) leaking into delta template with descriptive error messages

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Delta re-review formatting is complete (prompt template from 38-01, sanitizer from 38-02)
- Phase 38 is fully implemented: delta template, deltaContext threading, and sanitizer validation

---
*Phase: 38-delta-re-review-formatting*
*Completed: 2026-02-13*

## Self-Check: PASSED

All files and commits verified:
- src/execution/mcp/comment-server.ts: FOUND
- src/execution/mcp/comment-server.test.ts: FOUND
- 38-02-SUMMARY.md: FOUND
- Commit b022f1ee92: FOUND
- Commit e629b9adc7: FOUND

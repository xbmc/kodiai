---
phase: 35-findings-organization-and-tone
plan: 01
subsystem: review-prompt
tags: [prompt-engineering, impact-preference, severity-tags, pr-intent-scoping, tone-guidelines, stabilizing-language]

# Dependency graph
requires:
  - phase: 34-structured-review-template
    provides: Five-section summary template with ## Observations section and severity sub-headings
provides:
  - Impact/Preference subsections replacing severity sub-headings in Observations
  - Inline severity tags ([CRITICAL], [MAJOR], [MEDIUM], [MINOR]) on finding lines
  - PR intent scoping section using title, labels, and branch name
  - Finding Language Guidelines section with concrete language and stabilizing phrases
  - PR labels threading from webhook handler to prompt builder
affects: [35-02 sanitizer updates, review-prompt output format]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Impact/Preference finding organization in Observations section"
    - "Inline severity tags as finding line prefix: [SEVERITY] path (lines): title"
    - "PR intent scoping from title + labels + branch name"
    - "Concrete language enforcement with stabilizing phrases for low-risk changes"

key-files:
  created: []
  modified:
    - src/execution/review-prompt.ts
    - src/execution/review-prompt.test.ts
    - src/handlers/review.ts

key-decisions:
  - "Severity tags are inline on finding lines (not headings), following format: [SEVERITY] path (lines): title"
  - "PR labels displayed in both context header and intent scoping section when present, omitted entirely when empty"
  - "Intent scoping and tone guidelines inserted between Noise Suppression and Path Instructions sections"
  - "Preference findings capped at MEDIUM severity; CRITICAL/MAJOR always under Impact"

patterns-established:
  - "Impact/Preference template: ### Impact (required) and ### Preference (optional) replace ### Critical/Major/Medium/Minor"
  - "Helper function pattern for prompt sections: buildPrIntentScopingSection(), buildToneGuidelinesSection()"

# Metrics
duration: 3min
completed: 2026-02-13
---

# Phase 35 Plan 01: Findings Organization and Tone Summary

**Observations section rewritten to Impact/Preference subsections with inline severity tags, PR intent scoping from title/labels/branch, and concrete tone guidelines with stabilizing language**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T22:02:34Z
- **Completed:** 2026-02-13T22:05:19Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Replaced severity sub-headings (### Critical/Major/Medium/Minor) with Impact/Preference subsections using inline severity tags in the Observations template
- Added buildPrIntentScopingSection() helper that scopes findings to PR intent based on title, labels, and branch name
- Added buildToneGuidelinesSection() helper enforcing concrete language, anti-hedge patterns, and stabilizing phrases for low-risk changes
- Threaded PR labels from webhook handler through to prompt builder with conditional display
- Added 18 comprehensive test cases covering all new functionality

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite Observations template, add PR intent scoping and tone guidelines, thread PR labels** - `1f20a0ba65` (feat)
2. **Task 2: Add comprehensive tests for Impact/Preference template, PR intent scoping, tone guidelines, and PR labels** - `cdf88b5a62` (test)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Rewrote Observations template, added buildPrIntentScopingSection() and buildToneGuidelinesSection() helpers, added prLabels parameter
- `src/execution/review-prompt.test.ts` - 18 new tests for Phase 35 changes in dedicated describe block
- `src/handlers/review.ts` - Extract PR labels from payload, pass to buildReviewPrompt()

## Decisions Made
- Severity tags are inline on finding lines (not headings), following format: `[SEVERITY] path (lines): title` -- keeps the finding format flat and scannable
- PR labels displayed in both the context header (as `Labels: x, y`) and in the intent scoping section -- context header gives Claude data, intent section gives it instructions on how to use it
- Preference findings capped at MEDIUM severity per hard requirement; CRITICAL/MAJOR always under Impact -- prevents inflation of style nits
- Intent scoping and tone guidelines sections inserted between Noise Suppression and Path Instructions -- keeps prompt flow logical (noise rules -> scoping rules -> language rules -> path-specific rules)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Observations template now uses Impact/Preference format -- ready for 35-02 sanitizer updates to validate the new structure
- All existing tests pass with the new format; no regressions

## Self-Check: PASSED

All created/modified files verified present. All commit hashes verified in git log.

---
*Phase: 35-findings-organization-and-tone*
*Completed: 2026-02-13*

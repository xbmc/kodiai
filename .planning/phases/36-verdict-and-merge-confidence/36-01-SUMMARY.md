---
phase: 36-verdict-and-merge-confidence
plan: 01
subsystem: prompt-engineering
tags: [verdict, merge-confidence, blocker-logic, suggestions, review-prompt]

# Dependency graph
requires:
  - phase: 35-findings-organization-and-tone
    provides: "Impact/Preference split with severity-tagged finding lines"
provides:
  - "Three merge-recommendation verdict states (Ready to merge / Ready to merge with minor items / Address before merging)"
  - "buildVerdictLogicSection() helper with deterministic blocker-counting rules"
  - "Suggestions template with Optional:/Future consideration: prefixes"
  - "Hard requirements linking verdict to blocker count"
affects: [36-02, comment-server-sanitizer]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Verdict Logic prompt section for deterministic verdict selection", "Blocker = CRITICAL or MAJOR under Impact"]

key-files:
  created: []
  modified:
    - "src/execution/review-prompt.ts"
    - "src/execution/review-prompt.test.ts"

key-decisions:
  - "Verdict Logic section placed after </details> closing tag but before hard requirements, so Claude reads logic before rules"
  - "buildVerdictLogicSection exported as a standalone helper for testability and potential reuse in sanitizer"

patterns-established:
  - "Blocker-driven verdict: CRITICAL/MAJOR = blocker, everything else is non-blocking"
  - "Suggestions explicitly non-blocking with required Optional:/Future consideration: prefixes"

# Metrics
duration: 2min
completed: 2026-02-13
---

# Phase 36 Plan 01: Verdict & Merge Confidence Summary

**Merge-recommendation verdict labels with deterministic blocker-counting logic and explicit suggestion labeling in review prompt**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T22:31:39Z
- **Completed:** 2026-02-13T22:33:24Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced subjective verdict labels (Looks good / Needs changes / Blocker) with merge-actionable labels (Ready to merge / Ready to merge with minor items / Address before merging)
- Added Verdict Logic prompt section with deterministic 4-step blocker-counting rules
- Updated Suggestions template to require Optional: or Future consideration: prefix on every item
- Updated hard requirements to enforce blocker-driven verdict and exclude suggestions from merge readiness
- Added 8 comprehensive tests covering all new prompt content

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite Verdict template, add Verdict Logic section, update Suggestions template and hard requirements** - `0627ca3785` (feat)
2. **Task 2: Add tests for verdict template, verdict logic section, suggestions format, and hard requirements** - `5446ca0887` (test)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Updated verdict template, added buildVerdictLogicSection() helper, updated suggestions template, updated hard requirements
- `src/execution/review-prompt.test.ts` - Added 8 new tests in "Phase 36: Verdict & Merge Confidence" describe block

## Decisions Made
- Verdict Logic section placed after the summary comment template closing tag but before hard requirements, so Claude reads the deterministic logic before the enforcement rules
- buildVerdictLogicSection() exported as a standalone helper function for testability and potential reuse

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Verdict template and logic complete, ready for Plan 02 (sanitizer verdict-observations consistency check)
- The sanitizer in comment-server.ts can now cross-reference blocker counts against the verdict emoji

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 36-verdict-and-merge-confidence*
*Completed: 2026-02-13*

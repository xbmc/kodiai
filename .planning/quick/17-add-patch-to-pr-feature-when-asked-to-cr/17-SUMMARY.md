---
phase: quick-17
plan: 1
subsystem: mention-handler
tags: [write-mode, patch-intent, pr-surface, regex]

requires:
  - phase: mention-handler
    provides: existing write intent detection and PR surface handling
provides:
  - PR-surface implicit patch intent detection via detectImplicitPrPatchIntent
affects: [mention-handler, write-mode]

tech-stack:
  added: []
  patterns: [narrow regex-based intent detection for PR surfaces separate from broad issue intent]

key-files:
  created: []
  modified:
    - src/handlers/mention.ts
    - src/handlers/mention.test.ts

key-decisions:
  - "Narrow patch-only detection for PR surfaces to avoid false positives with broad verbs like fix/update"
  - "Return 'apply' keyword (not 'change' or 'plan') since patch intent maps to apply semantics"

patterns-established:
  - "PR surface intent detection is separate and narrower than issue surface intent detection"

requirements-completed: [PATCH-01]

duration: 2min
completed: 2026-03-03
---

# Quick Task 17: Add Patch-to-PR Feature Summary

**Narrow patch-specific phrase detection on PR surfaces triggers write mode for "create a patch" style requests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T04:14:48Z
- **Completed:** 2026-03-03T04:16:44Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Added `detectImplicitPrPatchIntent()` function that matches patch-specific phrases (create/make/open/submit a patch, patch this/the/that, polite variants, contextual "apply earlier suggestion as patch PR")
- Wired PR patch intent into write intent calculation alongside existing issue intent detection
- Renamed existing test to clarify it covers non-patch verbs only
- Added 3 new integration tests covering patch phrases, non-patch safety, and explicit prefix preservation

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests for patch intent** - `25d1d1c9f9` (test)
2. **Task 1 GREEN: Implement detectImplicitPrPatchIntent** - `b0d41ac420` (feat)

## Files Created/Modified
- `src/handlers/mention.ts` - Added `detectImplicitPrPatchIntent()` function and wired it into write intent block
- `src/handlers/mention.test.ts` - Renamed existing test, added 3 new integration tests for patch intent on PR surfaces

## Decisions Made
- Kept detection narrow (patch-specific only) to prevent false positives from broad verbs like "fix" or "update" on PR surfaces
- Reused existing `stripIssueIntentWrappers()` for normalization consistency
- Returns "apply" keyword since patch requests map to the apply (not plan) write mode

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

---
*Quick Task: 17*
*Completed: 2026-03-03*

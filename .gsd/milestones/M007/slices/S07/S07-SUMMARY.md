---
id: S07
parent: M007
milestone: M007
provides:
  - "Three merge-recommendation verdict states (Ready to merge / Ready to merge with minor items / Address before merging)"
  - "buildVerdictLogicSection() helper with deterministic blocker-counting rules"
  - "Suggestions template with Optional:/Future consideration: prefixes"
  - "Hard requirements linking verdict to blocker count"
  - "Verdict-observations cross-check enforcing red verdict only with CRITICAL/MAJOR blockers"
  - "Soft warning when green verdict used despite blockers present"
  - "All test data updated to new verdict labels (Ready to merge, Ready to merge with minor items, Address before merging)"
requires: []
affects: []
key_files: []
key_decisions:
  - "Verdict Logic section placed after </details> closing tag but before hard requirements, so Claude reads logic before rules"
  - "buildVerdictLogicSection exported as a standalone helper for testability and potential reuse in sanitizer"
  - "blockerCount only counts CRITICAL/MAJOR under ### Impact (not ### Preference) to match blocker definition"
  - "Red verdict without blockers is hard error (throw); green verdict with blockers is soft warning (console.warn)"
patterns_established:
  - "Blocker-driven verdict: CRITICAL/MAJOR = blocker, everything else is non-blocking"
  - "Suggestions explicitly non-blocking with required Optional:/Future consideration: prefixes"
  - "Cross-section validation: sanitizer validates consistency between Observations content and Verdict emoji"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-13
blocker_discovered: false
---
# S07: Verdict And Merge Confidence

**# Phase 36 Plan 01: Verdict & Merge Confidence Summary**

## What Happened

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

# Phase 36 Plan 02: Verdict-Observations Cross-Check Summary

**Sanitizer cross-check enforcing verdict emoji consistency with blocker count from Impact findings**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T22:31:40Z
- **Completed:** 2026-02-13T22:36:06Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added blockerCount accumulator to Observations state machine, tracking CRITICAL/MAJOR findings under ### Impact
- Hard cross-check rejects :red_circle: verdict when zero blockers exist in Impact
- Soft cross-check warns (console.warn) when :green_circle: verdict used despite blockers present
- Updated all 22 test verdict lines from old labels (Block, Needs changes, Approve) to new Phase 36 labels (Address before merging, Ready to merge with minor items, Ready to merge)
- Added 7 new cross-check tests covering all verdict-blocker consistency scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: Add verdict-observations cross-check and update test data** - `93c37dc3af` (feat)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `src/execution/mcp/comment-server.ts` - Added blockerCount accumulator in Observations parsing and verdict-observations cross-check after parsing completes
- `src/execution/mcp/comment-server.test.ts` - Updated all existing test verdicts to new labels; added 7 new cross-check tests in dedicated describe block

## Decisions Made
- blockerCount only increments for CRITICAL/MAJOR under ### Impact (Preference findings with those severities do not count as blockers, matching the blocker definition from Phase 36 research)
- Red verdict without blockers is a hard error (throw) because it violates the core Phase 36 invariant; green verdict with blockers is a soft warning because Claude might have legitimate reasons for the override

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Sanitizer-level verdict-observations consistency gate is in place
- Phase 36-01 (prompt template updates for verdict logic and suggestion labels) can proceed independently
- All 437 tests passing across the full suite

## Self-Check: PASSED

- FOUND: src/execution/mcp/comment-server.ts
- FOUND: src/execution/mcp/comment-server.test.ts
- FOUND: .planning/phases/36-verdict-and-merge-confidence/36-02-SUMMARY.md
- FOUND: commit 93c37dc3af

---
*Phase: 36-verdict-and-merge-confidence*
*Completed: 2026-02-13*

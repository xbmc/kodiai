---
phase: 94-depends-pr-deep-review
plan: 04
subsystem: review-pipeline
tags: [depends, review-comment, verdict, inline-comments, pipeline-integration, kodi, c-cpp]

requires:
  - phase: 94-01
    provides: "detectDependsBump() for [depends] PR title detection"
  - phase: 94-02
    provides: "parseVersionFileDiff, fetchDependsChangelog, verifyHash, detectPatchChanges"
  - phase: 94-03
    provides: "findDependencyConsumers, checkTransitiveDependencies"
provides:
  - "computeDependsVerdict() heuristic-based safe/needs-attention/risky verdict"
  - "buildDependsReviewComment() structured markdown with TL;DR, version diff, changelog, impact, hash sections"
  - "buildDependsInlineComments() for hash mismatch, patch removal, and new transitive dep findings"
  - "End-to-end [depends] deep-review pipeline wired into review handler"
affects: [pr-review-pipeline, depends-review-output]

tech-stack:
  added: []
  patterns: [verdict-heuristic, structured-review-comment, inline-review-comments, mutual-exclusion-guard, fail-open-pipeline]

key-files:
  created:
    - src/lib/depends-review-builder.ts
    - src/lib/depends-review-builder.test.ts
  modified:
    - src/handlers/review.ts

key-decisions:
  - "Verdict heuristic: risky on hash mismatch/patch removal/breaking+many-consumers; needs-attention on breaking/transitive/many-consumers/hash-unavailable; safe otherwise"
  - "Full pipeline wrapped in try/catch with fail-open: on failure, dependsBumpInfo reset to null so Dependabot detection can still run"
  - "PR files fetched via pulls.listFiles API to get status and patch data for patch detection and inline comments"
  - "Standard Claude review only runs when PR touches source code beyond build config paths (tools/depends/, cmake/modules/, etc)"
  - "Retrieval context fetched via existing retriever dependency injection, formatted as bullet list of top 3 results"

patterns-established:
  - "Mutual exclusion guard: detectDependsBump before detectDepBump, wrapped in if (!dependsBumpInfo)"
  - "Pipeline fail-open: entire [depends] block in try/catch, resets to null on failure for graceful fallback"
  - "Inline comment generation: findPatchLineNumber() parses unified diff to locate new-file line numbers for GitHub review API"

requirements-completed: [DEPS-01, DEPS-02, DEPS-03, DEPS-04, DEPS-05, DEPS-06, DEPS-07, DEPS-08]

duration: 5min
completed: 2026-02-25
---

# Phase 94 Plan 04: [depends] Deep Review Pipeline Integration Summary

**Structured review comment builder with TL;DR verdict and end-to-end pipeline wiring into review handler for Kodi [depends] dependency bump PRs**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-25T18:56:14Z
- **Completed:** 2026-02-25T19:01:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Built `depends-review-builder.ts` with verdict computation, structured comment builder, and inline comment generation
- Wired complete [depends] deep-review pipeline into `review.ts` handler: detection, enrichment, impact analysis, retrieval, comment posting
- Enforced mutual exclusivity: detectDependsBump() runs before detectDepBump(), skipping Dependabot path when matched
- Standard Claude review conditionally runs only when PR touches source code beyond build configs
- All 96 tests pass (24 new + 72 existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build structured review comment builder with tests** - `169c76abff` (feat)
2. **Task 2: Wire [depends] deep-review pipeline into review handler** - `36daa12473` (feat)

## Files Created/Modified
- `src/lib/depends-review-builder.ts` - Comment builder with verdict computation, structured markdown output, inline comments
- `src/lib/depends-review-builder.test.ts` - 24 tests covering verdict, comment, multi-package, degradation, inline scenarios
- `src/handlers/review.ts` - Pipeline integration with detection, enrichment, impact, retrieval, posting, mutual exclusion

## Decisions Made
- Verdict heuristic prioritizes risky > needs-attention > safe with clear triggers for each level
- Full pipeline fail-open: on unexpected error, resets dependsBumpInfo to null so Dependabot path can still run
- PR files fetched via GitHub API (pulls.listFiles) to get file status and patch content needed for detectPatchChanges and inline comments
- Retrieval context formatted as simple bullet list of top 3 unified results
- Build config paths for source-change detection: tools/depends/, cmake/modules/, project/BuildDependencies/, project/cmake/

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed detectDependsBump() call signature**
- **Found during:** Task 2
- **Issue:** Plan pseudo-code used `detectDependsBump({ prTitle: pr.title })` but actual function takes plain string
- **Fix:** Called as `detectDependsBump(pr.title)` matching actual API
- **Files modified:** src/handlers/review.ts
- **Verification:** Handler compiles without errors

**2. [Rule 3 - Blocking] Added PR files fetch via GitHub API**
- **Found during:** Task 2
- **Issue:** Handler only had `allChangedFiles` (filename strings), but pipeline needs status and patch data
- **Fix:** Added `pulls.listFiles` API call to fetch PR files with status/patch before enrichment
- **Files modified:** src/handlers/review.ts
- **Verification:** Handler compiles and tests pass

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both adaptations necessary to match actual code interfaces. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 94 complete: all 4 plans executed (detection, enrichment, impact analysis, pipeline integration)
- [depends] deep-review pipeline is end-to-end functional
- Ready for production testing with actual Kodi [depends] PRs

---
*Phase: 94-depends-pr-deep-review*
*Completed: 2026-02-25*

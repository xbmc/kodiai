---
phase: 54-security-advisory-changelog
plan: 02
subsystem: api
tags: [security-advisories, changelog, review-prompt, dep-bump-enrichment, fail-open]

# Dependency graph
requires:
  - phase: 54-security-advisory-changelog
    plan: 01
    provides: "fetchSecurityAdvisories, fetchChangelog, SecurityContext, ChangelogContext types, extended DepBumpContext"
  - phase: 53-dependency-bump-detection
    provides: "DepBumpContext, dep bump detection in review handler, buildDepBumpSection in review prompt"
provides:
  - "End-to-end security advisory and changelog enrichment in live review pipeline"
  - "Review prompt renders CVE/advisory info with informational framing"
  - "Review prompt renders changelog/release notes with breaking change warnings"
  - "Character-budgeted enrichment sections (advisory: 500, changelog: 1500 chars)"
affects: [review-handler, review-prompt]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Promise.allSettled for parallel enrichment", "character-budgeted prompt sections", "informational advisory framing"]

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/execution/review-prompt.ts

key-decisions:
  - "Reuse idempotencyOctokit for enrichment calls rather than creating new instance (follows handler pattern)"
  - "Advisory section capped at 3 advisories max to prevent prompt bloat"
  - "Informational framing: 'advisories exist' not 'vulnerability detected' per STATE.md concern"

patterns-established:
  - "Enrichment sections appended to existing prompt sections (additive, not replacing)"
  - "truncateToCharBudget truncates at last newline for clean output"

# Metrics
duration: 3min
completed: 2026-02-15
---

# Phase 54 Plan 02: Integration Wiring Summary

**Dep bump enrichment wired into review handler with parallel advisory+changelog fetching, and review prompt extended with character-budgeted security and changelog sections using informational framing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-15T00:39:01Z
- **Completed:** 2026-02-15T00:42:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Wired fetchSecurityAdvisories and fetchChangelog into review handler with Promise.allSettled parallel execution
- Extended buildDepBumpSection to render security advisory info (GHSA IDs, severity, CVE, patched version)
- Extended buildDepBumpSection to render changelog/release notes with breaking change warnings
- Character budgets enforced: advisory section <= 500 chars, changelog section <= 1500 chars
- Fail-open behavior: enrichment errors logged, review proceeds with base dep bump context
- Group bumps and non-dep-bump PRs skip enrichment entirely

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire enrichment into review handler** - `6cc5042f68` (feat)
2. **Task 2: Extend review prompt with security and changelog sections** - `00888647bf` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Added enrichment import and parallel enrichment calls after dep bump detection
- `src/execution/review-prompt.ts` - Added SecurityContext/ChangelogContext imports, truncateToCharBudget helper, buildSecuritySection, buildChangelogSection, and enrichment rendering in buildDepBumpSection

## Decisions Made
- Used `idempotencyOctokit` (already in scope) for enrichment API calls instead of creating a new octokit instance -- follows the handler's pattern of reusing available instances
- Advisory section shows max 3 advisories to keep prompt concise
- Informational framing for all advisories ("advisories exist for this package, they may or may not affect your specific usage") per STATE.md concern about CVE false positive rates

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed octokit variable reference in enrichment block**
- **Found during:** Task 1 (wire enrichment into review handler)
- **Issue:** Plan specified `octokit: octokit` but `octokit` is not in scope at the enrichment insertion point -- it's only available inside a conditional block at line 1178
- **Fix:** Used `idempotencyOctokit` which is available in the outer scope (created at line 1231, used for commit fetching and other operations)
- **Files modified:** src/handlers/review.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors in review.ts
- **Committed in:** 6cc5042f68 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug - incorrect variable reference in plan)
**Impact on plan:** Minor variable name correction. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 54 complete: end-to-end security advisory and changelog enrichment operational
- All dep bump PRs now receive enriched review context with advisory and changelog data
- Enrichment is additive and fail-open -- zero regression risk to existing reviews

---
*Phase: 54-security-advisory-changelog*
*Completed: 2026-02-15*

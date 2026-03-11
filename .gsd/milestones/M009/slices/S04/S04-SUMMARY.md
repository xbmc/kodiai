---
id: S04
parent: M009
milestone: M009
provides:
  - "fetchSecurityAdvisories function for GitHub Advisory API lookup"
  - "fetchChangelog function with three-tier fallback (releases, CHANGELOG.md, compare URL)"
  - "resolveGitHubRepo function for npm/python/ruby package-to-repo resolution"
  - "extractBreakingChanges function for BREAKING CHANGE marker detection"
  - "SecurityContext and ChangelogContext types"
  - "Extended DepBumpContext with optional security and changelog fields"
  - "End-to-end security advisory and changelog enrichment in live review pipeline"
  - "Review prompt renders CVE/advisory info with informational framing"
  - "Review prompt renders changelog/release notes with breaking change warnings"
  - "Character-budgeted enrichment sections (advisory: 500, changelog: 1500 chars)"
requires: []
affects: []
key_files: []
key_decisions:
  - "Breaking change markers ordered most-specific first to prevent duplicate matches from overlapping patterns"
  - "Removed generic BREAKING word marker; kept INCOMPATIBLE, heading, and bold patterns to avoid false positives"
  - "Both advisory API calls failing returns null (fail-open); one failing returns partial data"
  - "Reuse idempotencyOctokit for enrichment calls rather than creating new instance (follows handler pattern)"
  - "Advisory section capped at 3 advisories max to prevent prompt bloat"
  - "Informational framing: 'advisories exist' not 'vulnerability detected' per STATE.md concern"
patterns_established:
  - "Ecosystem mapping: Phase 53 names -> Advisory API names via ECOSYSTEM_TO_ADVISORY constant"
  - "Registry resolution: npm/python/ruby only in V1; other ecosystems return null"
  - "Character budgets: 500 chars per release body, 1500 chars total changelog"
  - "Enrichment sections appended to existing prompt sections (additive, not replacing)"
  - "truncateToCharBudget truncates at last newline for clean output"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-15
blocker_discovered: false
---
# S04: Security Advisory Changelog

**# Phase 54 Plan 01: Dependency Bump Enrichment Module Summary**

## What Happened

# Phase 54 Plan 01: Dependency Bump Enrichment Module Summary

**Security advisory lookup via GitHub Advisory API, changelog fetching with three-tier fallback (releases/CHANGELOG.md/compare-URL), and package-to-repo resolution for npm/python/ruby ecosystems**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-15T00:32:21Z
- **Completed:** 2026-02-15T00:36:25Z
- **Tasks:** 3 (TDD RED/GREEN + type extension)
- **Files modified:** 3

## Accomplishments
- Created dep-bump-enrichment module with four core functions: fetchSecurityAdvisories, fetchChangelog, resolveGitHubRepo, extractBreakingChanges
- 28 tests covering advisory lookup, repo resolution, changelog fetching tiers, breaking change detection, fail-open behavior, and ecosystem mapping
- Extended DepBumpContext type with optional security and changelog fields (non-breaking change)
- All functions follow fail-open pattern -- return null on any error

## Task Commits

Each task was committed atomically:

1. **RED: Failing tests** - `6e8bd17392` (test)
2. **GREEN: Implementation** - `7f7f303c2f` (feat)
3. **Type extension** - `932f93d777` (feat)

_TDD plan: RED and GREEN phases committed separately._

## Files Created/Modified
- `src/lib/dep-bump-enrichment.ts` - Core enrichment module with advisory lookup, changelog fetching, repo resolution, breaking change detection
- `src/lib/dep-bump-enrichment.test.ts` - 28 unit tests with mocked octokit and fetch responses
- `src/lib/dep-bump-detector.ts` - Extended DepBumpContext type with optional security/changelog fields

## Decisions Made
- Breaking change markers reordered to most-specific-first to prevent duplicate matches (e.g., `## Breaking` was matching both heading and generic word patterns)
- Removed generic `\bBREAKING\b` word pattern; kept `BREAKING CHANGE:`, `## Breaking`, `**Breaking**`, and `INCOMPATIBLE` to reduce false positives
- When both advisory API calls fail (both old and new version queries), return null; when only one fails, return partial data from the successful call

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Breaking change marker ordering caused duplicate matches**
- **Found during:** GREEN phase (test failures)
- **Issue:** Generic `\bBREAKING\b` pattern matched the same text as more specific patterns like `## Breaking` and `**Breaking**`, producing duplicate snippets
- **Fix:** Reordered markers most-specific-first and used break-after-first-match. Removed generic `BREAKING` word pattern; kept `INCOMPATIBLE` separately.
- **Files modified:** src/lib/dep-bump-enrichment.ts
- **Verification:** All 28 tests pass
- **Committed in:** 7f7f303c2f (GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor pattern ordering fix for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Enrichment module ready for wiring into review handler (Plan 54-02)
- SecurityContext and ChangelogContext types exported for use in review-prompt.ts
- DepBumpContext extended -- review.ts can populate security/changelog fields after detection

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 54-security-advisory-changelog*
*Completed: 2026-02-15*

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

---
id: S10
parent: M007
milestone: M007
provides:
  - SeverityPattern, DetectedTooling, EnforcedFinding, LanguageRulesConfig types
  - detectRepoTooling function for workspace config file scanning
  - FORMATTER_CONFIGS and LINTER_CONFIGS constants
  - languageRules Zod schema in repoConfigSchema
  - suppressToolingFindings pure function for tooling-aware finding suppression
  - FORMATTING_KEYWORDS and IMPORT_ORDER_KEYWORDS keyword sets
  - isFormattingFinding and isImportOrderFinding helper functions
  - enforceSeverityFloors pure function for post-LLM severity enforcement
  - BUILTIN_SEVERITY_PATTERNS catalog (10 patterns across 8 languages)
  - matchesPattern keyword-set matcher (OR-of-AND groups)
  - severityRank severity ordering utility
  - applyEnforcement convenience orchestrator (detect -> suppress -> floor pipeline)
  - src/enforcement/index.ts barrel export for entire enforcement module
  - Review pipeline integration with enforcement between extraction and suppression matching
requires: []
affects: []
key_files: []
key_decisions:
  - "Go gofmt treated as always-on when go.mod exists (no config file needed)"
  - "Tooling detection is fail-open: filesystem errors return empty maps, never block review"
  - "pyproject.toml presence treated as formatter/linter likely configured (no TOML section parsing)"
  - "ESLint detection covers both legacy .eslintrc and flat config eslint.config.* formats"
  - "Only style and documentation categories are suppressable -- correctness, security, performance are never suppressed by tooling detection"
  - "Keyword matching uses OR-of-AND groups: at least one group must have all keywords present in normalized title"
  - "User toolingOverrides checked with explicit false comparison to allow granular per-type control"
  - "sql-injection pattern enforced even in test files (contextRelaxation.testFiles=false) -- security patterns never relaxed"
  - "User-defined patterns use substring matching (single keyword group) for simplicity; built-in patterns use multi-keyword AND groups"
  - "Empty language string on pattern means 'match any language' -- used for sql-injection cross-language enforcement"
  - "Enforcement runs between finding extraction and existing suppression matching (not before or after)"
  - "toolingSuppressed merged back after severity floors because enforceSeverityFloors always resets it to false"
  - "Empty extractedFindings array skips enforcement entirely (no unnecessary filesystem scan)"
  - "Category cast from string to FindingCategory is safe because enforcement preserves original ExtractedFinding values"
patterns_established:
  - "Fail-open detection: wrap filesystem checks in try/catch, return empty results on error"
  - "Config map constants: Record<string, string[]> for language-to-config-file mappings"
  - "OR-of-AND keyword matching: export keyword sets as string[][] for reuse and testability"
  - "Category guard: check finding category before any suppression logic to guarantee safety-critical findings are never suppressed"
  - "Keyword-set matching: OR of AND groups normalizes LLM output variation into deterministic matches"
  - "Context-aware enforcement: test files identified via filesByCategory.test set membership, not path heuristics"
  - "User pattern conversion: LanguageRulesConfig.severityFloors entries converted to SeverityPattern at call time"
  - "Pipeline stage merging: when later stages overwrite fields from earlier stages, orchestrator re-merges after all stages complete"
  - "Enforcement is fail-open at both applyEnforcement level (catch-all) and review handler level (empty array skip)"
observability_surfaces: []
drill_down_paths: []
duration: 8min
verification_result: passed
completed_at: 2026-02-14
blocker_discovered: false
---
# S10: Language Aware Enforcement

**# Phase 39 Plan 01: Foundation Types, Tooling Detection, and Config Schema Summary**

## What Happened

# Phase 39 Plan 01: Foundation Types, Tooling Detection, and Config Schema Summary

**Enforcement type contracts (SeverityPattern, DetectedTooling, EnforcedFinding), filesystem-based tooling detection with Go gofmt special case, and languageRules Zod schema extension for .kodiai.yml**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T02:09:24Z
- **Completed:** 2026-02-14T02:12:23Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created enforcement type contracts used by all subsequent plans (SeverityPattern, DetectedTooling, EnforcedFinding, LanguageRulesConfig)
- Built detectRepoTooling function scanning workspace for formatter/linter configs across 8 languages with Go gofmt special case
- Extended .kodiai.yml config schema with languageRules section (severityFloors, toolingOverrides, disableBuiltinFloors) with section-fallback parsing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create enforcement types and tooling detection module** - `9ca988d6eb` (feat)
2. **Task 2: Add languageRules schema to config and update section fallback parsing** - `5e8fe54f42` (feat)

## Files Created/Modified
- `src/enforcement/types.ts` - SeverityPattern, DetectedTooling, EnforcedFinding, LanguageRulesConfig type definitions
- `src/enforcement/tooling-detection.ts` - detectRepoTooling function, FORMATTER_CONFIGS, LINTER_CONFIGS constants
- `src/enforcement/tooling-detection.test.ts` - 14 tests for tooling detection (config detection, Go special case, fail-open)
- `src/execution/config.ts` - Added languageRulesSchema with section fallback parsing
- `src/execution/config.test.ts` - 6 new tests for languageRules config parsing and fallback

## Decisions Made
- Go gofmt treated as always-on when go.mod exists -- Go's formatter is built-in with no config file
- Fail-open detection: all filesystem errors caught and return empty maps rather than blocking reviews
- pyproject.toml presence treated as "formatter/linter likely configured" without parsing TOML sections
- ESLint detection covers both legacy .eslintrc variants and flat config eslint.config.* formats

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All enforcement types exported and available for Plan 02 (severity floors) and Plan 03 (tooling suppression)
- detectRepoTooling ready for integration into review pipeline in Plan 04
- languageRules config section available via loadRepoConfig for user overrides
- 84 tests pass across both test files (14 tooling + 70 config)

## Self-Check: PASSED

- All 6 files verified present on disk
- Commits 9ca988d6eb and 5e8fe54f42 verified in git log

---
*Phase: 39-language-aware-enforcement*
*Completed: 2026-02-14*

# Phase 39 Plan 03: Tooling-Aware Finding Suppression Summary

**Pure-function finding suppression using OR-of-AND keyword matching to eliminate formatting/import-order noise when repo has formatter/linter configs, with user override support via .kodiai.yml toolingOverrides**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-14T02:14:48Z
- **Completed:** 2026-02-14T02:17:17Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Built suppressToolingFindings pure function that marks formatting/import-order findings as suppressed when repo has detected tooling
- 13 formatting keyword groups and 6 import-order keyword groups for finding classification
- Category guard ensures correctness, security, and performance findings are never suppressed
- User toolingOverrides from .kodiai.yml respected per language and per suppression type

## Task Commits

Each task was committed atomically:

1. **Task 1: RED - Write failing tests** - `5488357d63` (test)
2. **Task 2: GREEN - Implement suppression** - `95ef00a129` (feat)

_TDD plan: tests written first and verified failing, then implementation made all tests pass._

## Files Created/Modified
- `src/enforcement/tooling-suppression.ts` - suppressToolingFindings function, keyword sets, helper functions
- `src/enforcement/tooling-suppression.test.ts` - 27 tests covering all 10 behavior cases, category guards, edge cases

## Decisions Made
- Only style and documentation categories are suppressable -- never correctness, security, or performance (per research pitfall 6)
- Keyword matching uses OR-of-AND groups for precision: each group is an AND (all keywords must be present), groups are OR (any group can match)
- User override checked with `=== false` to distinguish "explicitly disabled" from "not configured"

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- suppressToolingFindings ready for integration into review pipeline in Plan 04
- Function accepts DetectedTooling from Plan 01's detectRepoTooling and optional LanguageRulesConfig from .kodiai.yml
- 41 tests pass across tooling-suppression (27) and tooling-detection (14) test files

## Self-Check: PASSED

- All 3 files verified present on disk
- Commits 5488357d63 and 95ef00a129 verified in git log

---
*Phase: 39-language-aware-enforcement*
*Completed: 2026-02-14*

# Phase 39 Plan 02: Severity Floor Enforcement Summary

**Pure severity floor enforcement with 10-pattern built-in catalog, OR-of-AND keyword matching for LLM output robustness, context-aware test file relaxation, and user-defined pattern support via .kodiai.yml**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-14T02:14:48Z
- **Completed:** 2026-02-14T02:17:36Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Built 10-pattern severity floor catalog covering C++ (null deref, uninitialized), C (null deref, buffer overflow), Go (unchecked error), Python (bare except), Rust (unwrap), Java (unclosed resource), SQL injection (any language), TypeScript (unhandled promise)
- Implemented enforceSeverityFloors pure function with context-aware enforcement -- test files get relaxation, production files get strict floors
- User-defined patterns from .kodiai.yml languageRules merge with or replace built-in catalog via disableBuiltinFloors flag
- 53 tests covering all behavior cases: elevation, relaxation, passthrough, language filtering, config integration

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Write failing tests for severity floor enforcement** - `3d76fac9c0` (test)
2. **Task 2: GREEN -- Implement severity-floors.ts** - `3378a1241d` (feat)

## Files Created/Modified
- `src/enforcement/severity-floors.ts` - enforceSeverityFloors, matchesPattern, severityRank, BUILTIN_SEVERITY_PATTERNS
- `src/enforcement/severity-floors.test.ts` - 53 tests covering all behavior cases

## Decisions Made
- sql-injection pattern enforced even in test files -- security-critical patterns should never be relaxed regardless of file context
- User-defined patterns converted to SeverityPattern with single-keyword substring matching for simplicity
- Empty language string on a pattern means "match any language" for cross-language patterns like SQL injection

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- enforceSeverityFloors ready for pipeline integration in Plan 04
- All exports (enforceSeverityFloors, matchesPattern, severityRank, BUILTIN_SEVERITY_PATTERNS) available for import
- 560 tests pass across full test suite (53 new + 507 existing)

## Self-Check: PASSED

- All 2 files verified present on disk
- Commits 3d76fac9c0 and 3378a1241d verified in git log

---
*Phase: 39-language-aware-enforcement*
*Completed: 2026-02-14*

# Phase 39 Plan 04: Pipeline Integration and Barrel Export Summary

**Enforcement barrel export with applyEnforcement orchestrator wired into review.ts between finding extraction and suppression matching, completing language-aware enforcement with fail-open error handling and 5 integration tests**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-14T02:19:40Z
- **Completed:** 2026-02-14T02:28:28Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created src/enforcement/index.ts barrel export re-exporting all types, functions, and constants from the enforcement module
- Built applyEnforcement convenience function orchestrating detect -> suppress -> floor pipeline in correct order with fail-open error handling
- Integrated enforcement into review.ts between finding extraction and suppression matching
- toolingSuppressed findings treated as suppressed and filtered from visible output (inline comments deleted)
- Severity-elevated findings flow at enforced severity through confidence computation and knowledge store recording
- 5 new integration tests covering severity elevation, tooling suppression, fail-open, skip-on-error, and Go severity elevation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create enforcement barrel export with convenience wrapper** - `68b14d3396` (feat)
2. **Task 2: Integrate enforcement pipeline into review handler** - `5af2e892b5` (feat)

## Files Created/Modified
- `src/enforcement/index.ts` - Barrel export with applyEnforcement orchestrator, re-exports all types/functions/constants
- `src/handlers/review.ts` - Enforcement pipeline integration between extraction and suppression matching
- `src/handlers/review.test.ts` - 5 new integration tests for enforcement in the review pipeline

## Decisions Made
- Enforcement runs between finding extraction and existing suppression matching -- this position ensures enforcement metadata is available for suppression, confidence computation, and knowledge store recording
- Empty extractedFindings array (conclusion !== "success") skips enforcement entirely to avoid unnecessary filesystem scanning
- Category field cast from string to FindingCategory at the processedFindings boundary since enforcement preserves original values
- toolingSuppressed flag merged back after severity floors step because enforceSeverityFloors always resets it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed toolingSuppressed flag being overwritten by severity floors**
- **Found during:** Task 2 (enforcement integration testing)
- **Issue:** enforceSeverityFloors always sets toolingSuppressed: false on its output, overwriting the true value from suppressToolingFindings
- **Fix:** Added post-pipeline merge in applyEnforcement to restore toolingSuppressed from the suppression step results
- **Files modified:** src/enforcement/index.ts
- **Verification:** toolingSuppressed integration test passes, formatting findings are properly suppressed
- **Committed in:** 5af2e892b5 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Essential for correctness -- without the fix, tooling suppression would never take effect in the live pipeline. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 39 (Language-Aware Enforcement) is fully complete
- All enforcement components wired into the live review pipeline
- 565 tests pass across the full test suite (94 enforcement + 33 review handler + 438 other)
- Ready for phase verification and milestone progression

## Self-Check: PASSED

- All 3 files verified present on disk
- Commits 68b14d3396 and 5af2e892b5 verified in git log

---
*Phase: 39-language-aware-enforcement*
*Completed: 2026-02-14*

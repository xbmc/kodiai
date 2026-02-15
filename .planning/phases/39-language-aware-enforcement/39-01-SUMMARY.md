---
phase: 39-language-aware-enforcement
plan: 01
subsystem: enforcement
tags: [zod, bun-test, tooling-detection, severity-floors, config-schema]

requires:
  - phase: knowledge-types
    provides: FindingSeverity, FindingCategory type definitions
provides:
  - SeverityPattern, DetectedTooling, EnforcedFinding, LanguageRulesConfig types
  - detectRepoTooling function for workspace config file scanning
  - FORMATTER_CONFIGS and LINTER_CONFIGS constants
  - languageRules Zod schema in repoConfigSchema
affects: [39-02 severity-floors, 39-03 tooling-suppression, 39-04 pipeline-integration]

tech-stack:
  added: []
  patterns: [fail-open detection, keyword-set config maps, Zod section-fallback]

key-files:
  created:
    - src/enforcement/types.ts
    - src/enforcement/tooling-detection.ts
    - src/enforcement/tooling-detection.test.ts
  modified:
    - src/execution/config.ts
    - src/execution/config.test.ts

key-decisions:
  - "Go gofmt treated as always-on when go.mod exists (no config file needed)"
  - "Tooling detection is fail-open: filesystem errors return empty maps, never block review"
  - "pyproject.toml presence treated as formatter/linter likely configured (no TOML section parsing)"
  - "ESLint detection covers both legacy .eslintrc and flat config eslint.config.* formats"

patterns-established:
  - "Fail-open detection: wrap filesystem checks in try/catch, return empty results on error"
  - "Config map constants: Record<string, string[]> for language-to-config-file mappings"

duration: 3min
completed: 2026-02-14
---

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

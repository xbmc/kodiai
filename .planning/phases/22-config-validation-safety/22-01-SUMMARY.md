---
phase: 22-config-validation-safety
plan: 01
subsystem: config
tags: [zod, yaml, config-parsing, forward-compat, graceful-degradation, safeParse]

# Dependency graph
requires: []
provides:
  - Forward-compatible config parsing (unknown keys stripped silently)
  - Section-level graceful degradation with structured warnings
  - LoadConfigResult return type with ConfigWarning array
affects: [23-prompt-template-system, 24-per-repo-prompt-overrides, 25-telemetry-structured-logging]

# Tech tracking
tech-stack:
  added: []
  patterns: [two-pass-safeParse, section-level-fallback, structured-config-warnings]

key-files:
  created: []
  modified:
    - src/execution/config.ts
    - src/execution/config.test.ts
    - src/handlers/review.ts
    - src/handlers/mention.ts
    - src/execution/executor.ts

key-decisions:
  - "Two-pass safeParse: fast path tries full schema, fallback parses each section independently"
  - "Unknown keys silently stripped (no .strict()), no .passthrough(), no .catch()"
  - "Section-level fallback: invalid section gets defaults + warning, valid sections preserved"

patterns-established:
  - "LoadConfigResult pattern: all config loading returns { config, warnings } not bare config"
  - "Section-level graceful degradation: one bad section does not break the whole config"

# Metrics
duration: 4min
completed: 2026-02-11
---

# Phase 22 Plan 01: Config Validation Safety Summary

**Forward-compatible .kodiai.yml parsing with two-pass safeParse and section-level graceful degradation via structured warnings**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-11T19:11:45Z
- **Completed:** 2026-02-11T19:15:58Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Removed all 4 `.strict()` calls from config sub-schemas, enabling forward-compatible config parsing
- Implemented two-pass safeParse with section-level fallback and structured ConfigWarning output
- Updated all 3 call sites (review.ts, mention.ts, executor.ts) to destructure and log warnings
- Expanded test suite from 16 to 26 tests covering forward-compat, graceful degradation, and edge cases
- All 150 tests pass across 14 files, TypeScript compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove .strict() and implement two-pass safeParse with LoadConfigResult** - `283044d5d9` (feat)
2. **Task 2: Update tests and add forward-compat and graceful degradation tests** - `be69cf39d2` (test)

## Files Created/Modified
- `src/execution/config.ts` - Extracted section schemas, removed .strict(), added two-pass safeParse with LoadConfigResult return type
- `src/execution/config.test.ts` - Updated all tests for new return type, added 10 new tests for forward-compat and degradation
- `src/handlers/review.ts` - Updated loadRepoConfig call site to destructure { config, warnings } and log warnings
- `src/handlers/mention.ts` - Updated loadRepoConfig call site to destructure { config, warnings } and log warnings
- `src/execution/executor.ts` - Updated loadRepoConfig call site to destructure { config, warnings } and log warnings

## Decisions Made
- Two-pass safeParse approach: try full schema first (fast path), fall back to per-section parsing only on failure
- Unknown keys silently stripped by default Zod behavior (no `.strict()`, no `.passthrough()`, no `.catch()`)
- Section-level fallback: each section parsed independently so one invalid section gets defaults + warning while valid sections are preserved

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added root-level warning for non-object YAML content**
- **Found during:** Task 2 (graceful degradation test for non-object config)
- **Issue:** When YAML content is a scalar (not an object), pass 2 treats all fields as undefined and silently uses defaults with no warnings, but the plan expected warnings to be present
- **Fix:** Added a root-level warning when parsed YAML is not an object: `{ section: "root", issues: ["Config is not an object, using all defaults"] }`
- **Files modified:** src/execution/config.ts
- **Verification:** "completely invalid config" test passes, warnings.length > 0
- **Committed in:** be69cf39d2 (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor addition for correctness -- ensures users are warned when their config file is completely invalid.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config parsing is now forward-compatible and failure-resilient
- LoadConfigResult pattern established for all config consumers
- Ready for prompt template system (phase 23) and per-repo prompt overrides (phase 24) which will add new config sections that benefit from this safety layer

---
*Phase: 22-config-validation-safety*
*Completed: 2026-02-11*

## Self-Check: PASSED
- All 5 modified files exist on disk
- Both task commits verified in git log (283044d5d9, be69cf39d2)
- SUMMARY.md exists at expected path

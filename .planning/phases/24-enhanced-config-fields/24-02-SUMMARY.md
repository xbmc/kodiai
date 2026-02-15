---
phase: 24-enhanced-config-fields
plan: 02
subsystem: config
tags: [zod, telemetry, cost-warning, config, yaml]

# Dependency graph
requires:
  - phase: 23-telemetry-foundation
    provides: "TelemetryStore.record() and telemetry capture in handlers"
  - phase: 22-config-validation-safety
    provides: "Two-pass config validation with section fallback"
provides:
  - "telemetrySchema in repoConfigSchema with enabled + costWarningUsd fields"
  - "Conditional telemetry recording gated by config.telemetry.enabled"
  - "Cost warning GitHub comment when execution cost exceeds threshold"
  - "Pass 2 section fallback for telemetry config"
affects: [telemetry, config, handlers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Telemetry gating: all telemetry logic (recording + cost warning) inside config.telemetry.enabled check"
    - "Cost warning suppressed when telemetry disabled (Pitfall 2 pattern)"

key-files:
  created: []
  modified:
    - src/execution/config.ts
    - src/execution/config.test.ts
    - src/handlers/review.ts
    - src/handlers/review.test.ts
    - src/handlers/mention.ts
    - src/handlers/mention.test.ts

key-decisions:
  - "Cost warning is inside telemetry.enabled gate, so disabling telemetry also suppresses cost warnings"
  - "Cost warning posts as a GitHub issue comment (not inline), with formatted USD amounts"

patterns-established:
  - "Telemetry gating: wrap telemetryStore.record + cost warning in config.telemetry.enabled check"

# Metrics
duration: 6min
completed: 2026-02-11
---

# Phase 24 Plan 02: Telemetry Config Summary

**Telemetry opt-out via config.telemetry.enabled and cost warning threshold via costWarningUsd in both review and mention handlers**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-11T20:50:27Z
- **Completed:** 2026-02-11T20:56:21Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added telemetrySchema to repoConfigSchema with enabled (default true) and costWarningUsd (default 0)
- Both handlers conditionally skip telemetry recording when telemetry.enabled is false
- Both handlers post a cost warning GitHub comment when costWarningUsd > 0 and execution cost exceeds threshold
- Cost warnings are suppressed when telemetry disabled (Pitfall 2 from research)
- Pass 2 section-level fallback handles invalid telemetry config gracefully

## Task Commits

Each task was committed atomically:

1. **Task 1: Add telemetry schema section to config** - `2d4ec84e98` (feat)
2. **Task 2: Wire telemetry opt-out and cost warning into handlers** - `089419774f` (feat, included with concurrent 24-01 commit)

## Files Created/Modified
- `src/execution/config.ts` - Added telemetrySchema, wired into repoConfigSchema, added Pass 2 fallback
- `src/execution/config.test.ts` - Added telemetry defaults, YAML parsing, and graceful degradation tests
- `src/handlers/review.ts` - Wrapped telemetry in config.telemetry.enabled check, added cost warning
- `src/handlers/review.test.ts` - Added CONFIG-10 opt-out and CONFIG-11 cost warning tests
- `src/handlers/mention.ts` - Wrapped telemetry in config.telemetry.enabled check, added cost warning
- `src/handlers/mention.test.ts` - Added CONFIG-10 opt-out and CONFIG-11 cost warning tests

## Decisions Made
- Cost warning is inside the telemetry.enabled gate, so disabling telemetry also suppresses cost warnings (per research Pitfall 2)
- Cost warning posts as a GitHub issue comment with formatted USD amounts (toFixed(4) for cost, toFixed(2) for threshold)
- Used mention.issueNumber (always present) instead of mention.issueNumber ?? mention.prNumber for comment target

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Task 2 handler source changes and test additions were absorbed into a concurrent 24-01 commit (089419774f) due to auto-staging. The work is complete and verified -- all 178 tests pass.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 24 complete -- all config enhancement fields implemented
- Telemetry opt-out and cost warning ready for production use

## Self-Check: PASSED

All files exist, all commits found, all content markers verified. 178/178 tests pass.

---
*Phase: 24-enhanced-config-fields*
*Completed: 2026-02-11*

---
id: S02
parent: M008
milestone: M008
provides:
  - Deterministic profile resolution utility with explicit precedence
  - Boundary-safe line-threshold mapping for strict, balanced, and minimal profiles
  - Machine-readable profile source and auto-band metadata for downstream transparency
  - Runtime profile selection integration in review handler
  - Review Details profile transparency line showing source and applied profile
  - Handler-level regression suite validating threshold and override behavior
requires: []
affects: []
key_files: []
key_decisions:
  - "Profile precedence is fixed as keyword override > manual config > auto-threshold"
  - "Auto selection metadata includes source and band for observability without handler coupling"
  - "Handler now resolves a single profile selection object before applying presets"
  - "Review Details always publishes profile source text (auto/manual/keyword) for traceability"
patterns_established:
  - "Profile resolution is a side-effect-free library utility consumed by handlers"
  - "Threshold boundaries are validated with explicit edge tests (100/101, 500/501)"
  - "Profile behavior is asserted via prompt and Review Details output, not internal variables"
  - "Profile selection logs include selectedProfile/source/linesChanged/autoBand for diagnostics"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-14
blocker_discovered: false
---
# S02: Auto Profile Selection

**# Phase 43 Plan 01: Auto Profile Resolver Summary**

## What Happened

# Phase 43 Plan 01: Auto Profile Resolver Summary

**Deterministic review profile resolution now maps PR size to strict/balanced/minimal while preserving explicit keyword and manual override precedence.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-14T09:42:28Z
- **Completed:** 2026-02-14T09:43:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added complete RED coverage for threshold boundaries and precedence order.
- Implemented pure `resolveReviewProfile` logic with deterministic keyword/manual/auto precedence.
- Returned machine-readable metadata (`source`, `autoBand`, `linesChanged`) for downstream logging and review details.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Add failing tests for threshold and precedence resolution** - `c40cad4d30` (test)
2. **Task 2: GREEN -- Implement resolver to satisfy tests with deterministic precedence** - `3829bc2352` (feat)

## Files Created/Modified
- `src/lib/auto-profile.ts` - Exports thresholds, resolver types, and deterministic profile selection function.
- `src/lib/auto-profile.test.ts` - Covers precedence and boundary behavior for profile selection contract.

## Decisions Made
- Fixed precedence contract in code rather than implicit handler ordering to keep behavior predictable across integrations.
- Encoded auto-band labels (`small`, `medium`, `large`) in resolver output to make Review Details/logging straightforward in Plan 02.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Resolver and tests are in place for handler integration in 43-02.
- Metadata contract is ready to surface applied profile source in Review Details.

---
*Phase: 43-auto-profile-selection*
*Completed: 2026-02-14*

## Self-Check: PASSED
- FOUND: `.planning/phases/43-auto-profile-selection/43-01-SUMMARY.md`
- FOUND: `c40cad4d30`
- FOUND: `3829bc2352`

# Phase 43 Plan 02: Handler Auto-Profile Integration Summary

**Review execution now uses resolver-based auto profile selection with explicit precedence and publishes the applied profile reason in both logs and Review Details.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T09:43:49Z
- **Completed:** 2026-02-14T09:46:28Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Wired `resolveReviewProfile` into handler flow using PR changed-line totals and deterministic precedence.
- Applied selected preset behavior to runtime severity/comment/focus configuration while preserving Phase 42 additive keyword handling.
- Added regression tests for threshold bands, manual override, keyword override, and Review Details profile transparency text.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire auto-profile resolver into review pipeline with explicit precedence** - `5259f207de` (feat)
2. **Task 2: Add regression tests for auto thresholds and override precedence in handler flow** - `2f78603ba0` (test)

## Files Created/Modified
- `src/handlers/review.ts` - Resolves profile once, logs selection metadata, and includes profile source in Review Details output.
- `src/handlers/review.test.ts` - Adds handler-flow regression tests for threshold defaults, overrides, and transparency output.

## Decisions Made
- Profile selection is resolved before preset application so handler behavior follows a single explicit source of truth.
- Transparency output is treated as a contract and validated in tests to keep operator-visible behavior stable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added defensive fallback for missing PR line counters**
- **Found during:** Task 1 (auto-profile resolver wiring)
- **Issue:** Some mocked or malformed payloads may omit `additions`/`deletions`, which can produce invalid math for threshold selection.
- **Fix:** Normalized profile line count with null-safe fallback to `0` before resolver invocation.
- **Files modified:** `src/handlers/review.ts`
- **Verification:** `bun test src/handlers/review.test.ts`
- **Committed in:** `5259f207de` (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Defensive hardening only; no scope creep and all planned behavior preserved.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Runtime profile behavior is deterministic and observable, ready for downstream experience-aware selection work.
- Handler tests now guard against precedence and transparency regressions.

---
*Phase: 43-auto-profile-selection*
*Completed: 2026-02-14*

## Self-Check: PASSED
- FOUND: `.planning/phases/43-auto-profile-selection/43-02-SUMMARY.md`
- FOUND: `5259f207de`
- FOUND: `2f78603ba0`

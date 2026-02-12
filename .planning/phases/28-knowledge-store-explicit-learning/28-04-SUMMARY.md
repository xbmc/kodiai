---
phase: 28-knowledge-store-explicit-learning
plan: 04
subsystem: infra
tags: [cli, reporting, sqlite, stats, trends]
requires:
  - phase: 28-knowledge-store-explicit-learning
    provides: reviews/findings/suppression schema in knowledge store
provides:
  - kodiai-stats CLI for repo-level aggregates
  - kodiai-trends CLI for daily historical rollups
  - read-only knowledge DB query workflows with JSON/human output
affects: [operations, diagnostics, learning-observability]
tech-stack:
  added: []
  patterns: [self-contained scripts, readonly sqlite access, util.parseArgs interface]
key-files:
  created: [scripts/kodiai-stats.ts, scripts/kodiai-trends.ts]
  modified: [scripts/kodiai-stats.ts]
key-decisions:
  - "Both scripts remain self-contained and avoid src imports to keep operator tooling decoupled"
  - "Human-readable output is default, with --json parity for automation"
patterns-established:
  - "CLI scripts validate db existence before opening and fail with actionable messages"
  - "Trend aggregation separates review and finding rollups to avoid double-counting suppressions"
duration: 5min
completed: 2026-02-12
---

# Phase 28 Plan 04: CLI Reporting Summary

**Two standalone reporting commands now expose repository stats and day-by-day review trends directly from the knowledge SQLite database.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-12T07:07:27Z
- **Completed:** 2026-02-12T07:15:12Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `kodiai-stats` with repo/time filters, severity breakdowns, confidence averages, top files, and JSON output
- Added `kodiai-trends` with daily review/finding/suppression/confidence rollups and JSON output
- Enforced read-only database mode, timeout PRAGMA, and graceful handling for missing DB or empty datasets

## Task Commits

1. **Task 1: create stats CLI script** - `fee6d11a1c` (feat)
2. **Task 2: create trends CLI script** - `1085d4d5ea` (feat)

## Files Created/Modified
- `scripts/kodiai-stats.ts` - repository-level stats command
- `scripts/kodiai-trends.ts` - daily trend reporting command

## Decisions Made
- Reused usage-report style argument parsing and output ergonomics for consistency
- Kept SQL parameterized with `$` bindings for safe filtering behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced `replaceAll` with `replace(/.../g)` for TS target compatibility**
- **Found during:** Task 1 verification
- **Issue:** TypeScript target in project does not expose `String.prototype.replaceAll`
- **Fix:** Switched SQL fragment normalization to regex `replace` calls
- **Files modified:** `scripts/kodiai-stats.ts`
- **Verification:** `bunx tsc --noEmit scripts/kodiai-stats.ts`
- **Committed in:** `fee6d11a1c`

---

**Total deviations:** 1 auto-fixed (rule 3)
**Impact on plan:** No behavior change; compatibility fix required for compilation.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Operators can inspect knowledge accumulation trends immediately from local runtime data
- CLI surface is ready for extension with future learning analytics

## Self-Check: PASSED
- Verified summary file and referenced task commits exist on disk/history.

---
*Phase: 28-knowledge-store-explicit-learning*
*Completed: 2026-02-12*

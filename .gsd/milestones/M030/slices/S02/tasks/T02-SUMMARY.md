---
id: T02
parent: S02
milestone: M030
provides: []
requires: []
affects: []
key_files: ["src/handlers/addon-check.ts", "src/handlers/addon-check.test.ts", "src/index.ts"]
key_decisions: ["Empty addonIds list returns early before enqueue to avoid creating a no-op workspace", "createMockLoggerWithArrays centralizes shared-array writes for child loggers", "Cleanup-on-throw test uses workspace.create throwing (not subprocess) since runAddonChecker fails open on non-ENOENT errors"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test src/handlers/addon-check.test.ts → 11 pass; bun test src/lib/addon-checker-runner.test.ts → 19 pass (regression clean); bun run tsc --noEmit → exit 0"
completed_at: 2026-03-28T16:09:02.845Z
blocker_discovered: false
---

# T02: Wire runAddonChecker into addon-check handler with workspace lifecycle, jobQueue enqueue, branch resolution, structured finding logs, and 11 passing tests

> Wire runAddonChecker into addon-check handler with workspace lifecycle, jobQueue enqueue, branch resolution, structured finding logs, and 11 passing tests

## What Happened
---
id: T02
parent: S02
milestone: M030
key_files:
  - src/handlers/addon-check.ts
  - src/handlers/addon-check.test.ts
  - src/index.ts
key_decisions:
  - Empty addonIds list returns early before enqueue to avoid creating a no-op workspace
  - createMockLoggerWithArrays centralizes shared-array writes for child loggers
  - Cleanup-on-throw test uses workspace.create throwing (not subprocess) since runAddonChecker fails open on non-ENOENT errors
duration: ""
verification_result: passed
completed_at: 2026-03-28T16:09:02.846Z
blocker_discovered: false
---

# T02: Wire runAddonChecker into addon-check handler with workspace lifecycle, jobQueue enqueue, branch resolution, structured finding logs, and 11 passing tests

**Wire runAddonChecker into addon-check handler with workspace lifecycle, jobQueue enqueue, branch resolution, structured finding logs, and 11 passing tests**

## What Happened

Updated addon-check.ts to accept workspaceManager and jobQueue, resolve Kodi branch from base.ref (warn+skip on unknown), short-circuit before enqueue on empty addonIds, clone head branch via workspaceManager.create, run runAddonChecker per addon with correct addonDir and kodiVersion, log toolNotFound/timedOut warnings, log structured findings per-addon and a completion summary, and call workspace.cleanup() in finally. Updated index.ts to pass the two new deps. Rewrote addon-check.test.ts with 11 tests covering all the new behaviors plus the retained scaffold tests updated to match new log messages.

## Verification

bun test src/handlers/addon-check.test.ts → 11 pass; bun test src/lib/addon-checker-runner.test.ts → 19 pass (regression clean); bun run tsc --noEmit → exit 0

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/handlers/addon-check.test.ts` | 0 | ✅ pass | 48ms |
| 2 | `bun test src/lib/addon-checker-runner.test.ts` | 0 | ✅ pass | 20ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 6000ms |


## Deviations

The cleanup-on-throw test uses workspace.create throwing instead of subprocess throwing, because runAddonChecker fails open on non-ENOENT errors — the outer finally block still runs correctly either way.

## Known Issues

None.

## Files Created/Modified

- `src/handlers/addon-check.ts`
- `src/handlers/addon-check.test.ts`
- `src/index.ts`


## Deviations
The cleanup-on-throw test uses workspace.create throwing instead of subprocess throwing, because runAddonChecker fails open on non-ENOENT errors — the outer finally block still runs correctly either way.

## Known Issues
None.

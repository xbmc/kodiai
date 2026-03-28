---
id: T01
parent: S02
milestone: M030
provides: []
requires: []
affects: []
key_files: ["src/lib/addon-checker-runner.ts", "src/lib/addon-checker-runner.test.ts"]
key_decisions: ["Reused withTimeBudget from usage-analyzer.ts rather than duplicating timeout logic", "addonId derived from last path segment of addonDir in runAddonChecker", "Non-ENOENT errors fail open matching usage-analyzer.ts convention"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test src/lib/addon-checker-runner.test.ts → 19 pass, 0 fail. bun run tsc --noEmit → exit 0."
completed_at: 2026-03-28T16:05:40.870Z
blocker_discovered: false
---

# T01: Created addon-checker-runner.ts with ANSI-stripping output parser, Kodi branch resolver, and injectable subprocess runner; 19/19 tests pass, TypeScript clean

> Created addon-checker-runner.ts with ANSI-stripping output parser, Kodi branch resolver, and injectable subprocess runner; 19/19 tests pass, TypeScript clean

## What Happened
---
id: T01
parent: S02
milestone: M030
key_files:
  - src/lib/addon-checker-runner.ts
  - src/lib/addon-checker-runner.test.ts
key_decisions:
  - Reused withTimeBudget from usage-analyzer.ts rather than duplicating timeout logic
  - addonId derived from last path segment of addonDir in runAddonChecker
  - Non-ENOENT errors fail open matching usage-analyzer.ts convention
duration: ""
verification_result: passed
completed_at: 2026-03-28T16:05:40.871Z
blocker_discovered: false
---

# T01: Created addon-checker-runner.ts with ANSI-stripping output parser, Kodi branch resolver, and injectable subprocess runner; 19/19 tests pass, TypeScript clean

**Created addon-checker-runner.ts with ANSI-stripping output parser, Kodi branch resolver, and injectable subprocess runner; 19/19 tests pass, TypeScript clean**

## What Happened

Built src/lib/addon-checker-runner.ts as a pure injectable module following the usage-analyzer.ts pattern. Reused withTimeBudget from usage-analyzer rather than duplicating it. The __runSubprocessForTests injection matches __runGrepForTests shape exactly. ANSI stripping uses the regex before line splitting. Non-zero exit codes are treated as normal (tool exits 1 when findings exist). Non-ENOENT errors fail open. addonId in parseCheckerOutput is caller-provided; runAddonChecker derives it from the last path segment of addonDir. Created 19 tests covering all three exported functions across all specified edge cases.

## Verification

bun test src/lib/addon-checker-runner.test.ts → 19 pass, 0 fail. bun run tsc --noEmit → exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/lib/addon-checker-runner.test.ts` | 0 | ✅ pass | 56ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6100ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/lib/addon-checker-runner.ts`
- `src/lib/addon-checker-runner.test.ts`


## Deviations
None.

## Known Issues
None.

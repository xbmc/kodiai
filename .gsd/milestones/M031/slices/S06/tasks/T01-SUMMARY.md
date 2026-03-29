---
id: T01
parent: S06
milestone: M031
provides: []
requires: []
affects: []
key_files: ["scripts/verify-m031.test.ts"]
key_decisions: ["Non-null assertion (!) is the correct fix — the runtime invariant is already established by the preceding expect().toBeGreaterThanOrEqual(1) call; ! is purely a type-level declaration."]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bunx tsc --noEmit exits 0 (no output). bun test ./scripts/verify-m031.test.ts: 23 pass, 0 fail."
completed_at: 2026-03-28T18:05:09.785Z
blocker_discovered: false
---

# T01: Fixed TS2532 in verify-m031.test.ts — added non-null assertion on failing[0]

> Fixed TS2532 in verify-m031.test.ts — added non-null assertion on failing[0]

## What Happened
---
id: T01
parent: S06
milestone: M031
key_files:
  - scripts/verify-m031.test.ts
key_decisions:
  - Non-null assertion (!) is the correct fix — the runtime invariant is already established by the preceding expect().toBeGreaterThanOrEqual(1) call; ! is purely a type-level declaration.
duration: ""
verification_result: passed
completed_at: 2026-03-28T18:05:09.786Z
blocker_discovered: false
---

# T01: Fixed TS2532 in verify-m031.test.ts — added non-null assertion on failing[0]

**Fixed TS2532 in verify-m031.test.ts — added non-null assertion on failing[0]**

## What Happened

Single-character fix: `failing[0].id` → `failing[0]!.id` on line 221. TypeScript array indexing produces `T | undefined` regardless of runtime length checks — the `!` asserts what `expect(failing.length).toBeGreaterThanOrEqual(1)` already guarantees at runtime.

## Verification

bunx tsc --noEmit exits 0 (no output). bun test ./scripts/verify-m031.test.ts: 23 pass, 0 fail.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bunx tsc --noEmit` | 0 | ✅ pass | 8100ms |
| 2 | `bun test ./scripts/verify-m031.test.ts` | 0 | ✅ pass | 4700ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m031.test.ts`


## Deviations
None.

## Known Issues
None.

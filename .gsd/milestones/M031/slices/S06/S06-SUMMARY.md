---
id: S06
parent: M031
milestone: M031
provides:
  - bunx tsc --noEmit exits 0 — codebase is clean of TypeScript errors
requires:
  []
affects:
  []
key_files:
  - scripts/verify-m031.test.ts
key_decisions:
  - Non-null assertion is the correct fix — runtime invariant already established, ! is a type-level declaration only.
patterns_established:
  - (none)
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M031/slices/S06/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-28T18:05:23.217Z
blocker_discovered: false
---

# S06: Fix TS2532 in verify-m031.test.ts — R001 remediation

**bunx tsc --noEmit now exits 0 across the codebase.**

## What Happened

Single-character fix to scripts/verify-m031.test.ts line 221: `failing[0].id` → `failing[0]!.id`. Array index access produces `T | undefined` in TypeScript's type system; the runtime invariant was already established by the preceding assertion but TypeScript requires an explicit non-null assertion.

## Verification

bunx tsc --noEmit exits 0 with no output. bun test ./scripts/verify-m031.test.ts: 23 pass, 0 fail.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `scripts/verify-m031.test.ts` — Added non-null assertion on failing[0]!.id (line 221) to fix TS2532

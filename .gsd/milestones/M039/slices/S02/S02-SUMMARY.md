---
id: S02
parent: M039
milestone: M039
provides:
  - Claude usage display shows percent-left with `remaining` suffix when rate-limit data is present.
  - Usage line is absent when `usageLimit` is undefined — truthful fallback.
requires:
  - slice: S01
    provides: Parser stripping fix as sequencing context
affects:
  []
key_files:
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/handlers/review.test.ts
key_decisions:
  - Percent-left = 100 - Math.round(utilization * 100); no interface change needed on execution result types.
patterns_established:
  - (none)
observability_surfaces:
  - Review Details text now shows percent remaining rather than percent used — visible in every published review comment with rate-limit data.
drill_down_paths:
  - .gsd/milestones/M039/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M039/slices/S02/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-04T21:02:57.798Z
blocker_discovered: false
---

# S02: Claude Usage Display \u2014 Percent-Left + Truthful Fallback

**Switched Claude usage display to percent-left and updated test contracts in both review-utils and handler tests.**

## What Happened

Changed the Claude Code usage line format from `${pct}% of ${type} limit` to `${pctLeft}% of ${type} limit remaining`. Updated one assertion in review-utils.test.ts and one in review.test.ts. All 73 handler tests and 3 review-utils tests pass. Type gate clean.

## Verification

`bun test ./src/lib/review-utils.test.ts` 3/3 pass; `bun test ./src/handlers/review.test.ts` 73/73 pass; `bun run tsc --noEmit` clean.

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

- `src/lib/review-utils.ts` — Changed Claude Code usage display from percent-used to percent-left with `remaining` suffix.
- `src/lib/review-utils.test.ts` — Updated assertion to `25% of seven_day limit remaining`.
- `src/handlers/review.test.ts` — Updated assertion to `20% of seven_day limit remaining`.

---
id: T01
parent: S02
milestone: M039
key_files:
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
key_decisions:
  - Compute percent-left as `100 - Math.round(utilization * 100)` and append `remaining` to the format string. The fallback behavior (absent line when usageLimit is undefined) was already correct and required no change.
duration: 
verification_result: passed
completed_at: 2026-04-04T21:02:24.364Z
blocker_discovered: false
---

# T01: Switched Claude usage display from percent-used to percent-left in review-utils.ts and updated the review-utils test.

**Switched Claude usage display from percent-used to percent-left in review-utils.ts and updated the review-utils test.**

## What Happened

Changed the Claude Code usage line in `formatReviewDetailsSummary` from `${pct}% of ${type} limit` to `${pctLeft}% of ${type} limit remaining`, where `pctLeft = 100 - pct`. Updated the review-utils test to assert on the new format. TSC exits clean.

## Verification

`bun test ./src/lib/review-utils.test.ts` 3/3 pass; `bun run tsc --noEmit` clean.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/review-utils.test.ts && bun run tsc --noEmit` | 0 | ✅ pass | 6500ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`

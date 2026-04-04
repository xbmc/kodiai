---
estimated_steps: 16
estimated_files: 2
skills_used: []
---

# T01: Switch Claude usage display to percent-left in review-utils.ts

Change `formatReviewDetailsSummary` in `src/lib/review-utils.ts` to display percent-left (100 - utilization*100) instead of percent-used, and update `src/lib/review-utils.test.ts` to assert the new format.

Steps:
1. Read `src/lib/review-utils.ts` lines 255-270 to see the current usage-line rendering.
2. Change the usage line from:
```ts
sections.push(`- Claude Code usage: ${pct}% of ${type} limit${resetStr}`);
```
to:
```ts
const pctLeft = 100 - pct;
sections.push(`- Claude Code usage: ${pctLeft}% of ${type} limit remaining${resetStr}`);
```
Keep the existing guard `if (usageLimit?.utilization !== undefined)` unchanged — the fallback behavior (no line when absent) is already correct.
3. Open `src/lib/review-utils.test.ts`. Update the assertion `expect(result).toContain('75% of seven_day limit')` to `expect(result).toContain('25% of seven_day limit remaining')`. Preserve the existing test that confirms the line is absent when `usageLimit` is undefined — that contract is already correct.
4. Run `bun test ./src/lib/review-utils.test.ts` and confirm all pass.
5. Run `bun run tsc --noEmit`.

## Inputs

- ``src/lib/review-utils.ts``
- ``src/lib/review-utils.test.ts``

## Expected Output

- ``src/lib/review-utils.ts``
- ``src/lib/review-utils.test.ts``

## Verification

bun test ./src/lib/review-utils.test.ts && bun run tsc --noEmit

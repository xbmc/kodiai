# S02: Claude Usage Display — Percent-Left + Truthful Fallback

**Goal:** Change `formatReviewDetailsSummary` in `src/lib/review-utils.ts` to display percent-left instead of percent-used for Claude usage, and update tests in `src/lib/review-utils.test.ts` and `src/handlers/review.test.ts` to lock the new contract.
**Demo:** After this: After this: Review Details shows `25% of seven_day limit remaining | resets ...` when utilization=0.75; the usage line is absent when usageLimit is undefined.

## Tasks
- [x] **T01: Switched Claude usage display from percent-used to percent-left in review-utils.ts and updated the review-utils test.** — Change `formatReviewDetailsSummary` in `src/lib/review-utils.ts` to display percent-left (100 - utilization*100) instead of percent-used, and update `src/lib/review-utils.test.ts` to assert the new format.

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
  - Estimate: 20m
  - Files: src/lib/review-utils.ts, src/lib/review-utils.test.ts
  - Verify: bun test ./src/lib/review-utils.test.ts && bun run tsc --noEmit
- [x] **T02: Updated handler test usage assertion to match the percent-left contract.** — Check whether `src/handlers/review.test.ts` contains any expectations about the Claude usage line format and update them to the percent-left contract.

Steps:
1. Run `grep -n 'seven_day\|pct\|percent\|usage.*limit\|limit.*usage\|Claude Code usage' src/handlers/review.test.ts` to find any usage-line assertions.
2. If present, update each to match `XX% of seven_day limit remaining`.
3. Run `bun test ./src/handlers/review.test.ts` and confirm all pass.
4. Run `bun run tsc --noEmit` for the full type gate.
  - Estimate: 15m
  - Files: src/handlers/review.test.ts
  - Verify: bun test ./src/handlers/review.test.ts && bun run tsc --noEmit

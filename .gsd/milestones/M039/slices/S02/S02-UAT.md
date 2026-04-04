# S02: Claude Usage Display \u2014 Percent-Left + Truthful Fallback — UAT

**Milestone:** M039
**Written:** 2026-04-04T21:02:57.798Z

# UAT — S02 Claude Usage Display\n\n## Steps\n1. Run `bun test ./src/lib/review-utils.test.ts`\n2. Run `bun test ./src/handlers/review.test.ts`\n\n## Expected\n- review-utils test asserts `25% of seven_day limit remaining`\n- handler test asserts `20% of seven_day limit remaining`\n- Both test files pass with 0 failures

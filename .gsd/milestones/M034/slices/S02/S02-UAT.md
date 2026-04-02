# S02: Render usage and tokens in Review Details — UAT

**Milestone:** M034
**Written:** 2026-04-02T20:27:14.927Z

# S02 UAT: Render usage and tokens in Review Details

## Preconditions
- Codebase at commit after M034/S01 and M034/S02 tasks complete
- `bun` and `tsc` available
- No Postgres required (pure unit + integration tests)

## Test Cases

### TC-01: Usage line renders with percentage, type, and reset time
**What:** formatReviewDetailsSummary renders the usage line when usageLimit is fully populated

**Steps:**
1. Run `bun test ./src/lib/review-utils.test.ts`
2. Observe test `renders usage line when usageLimit is present`

**Expected:**
- Test passes
- Result contains `75% of seven_day limit`
- Result contains `resets ` (ISO timestamp follows)
- Result contains `Claude Code usage:`

### TC-02: Token line renders with counts and cost
**What:** formatReviewDetailsSummary renders the token line when tokenUsage is populated

**Steps:**
1. Run `bun test ./src/lib/review-utils.test.ts`
2. Observe test `renders token line when tokenUsage is present`

**Expected:**
- Test passes
- Result contains `in /` and `out`
- Result contains `0.0123` (cost formatted to 4 decimal places)

### TC-03: Both lines are omitted when fields absent
**What:** formatReviewDetailsSummary does not pollute output when no usage data

**Steps:**
1. Run `bun test ./src/lib/review-utils.test.ts`
2. Observe test `omits usage and token lines when fields absent`

**Expected:**
- Test passes
- Result does NOT contain `Claude Code usage:`
- Result does NOT contain `Tokens:`

### TC-04: Integration — usage line appears in detailsCommentBody
**What:** End-to-end: review handler produces detailsCommentBody with usage line when executor returns usageLimit

**Steps:**
1. Run `bun test ./src/handlers/review.test.ts --timeout 60000`
2. Locate the test describing usage/token rendering in detailsCommentBody

**Expected:**
- 73 tests pass, 0 fail
- `detailsCommentBody` contains `80% of seven_day limit`
- `detailsCommentBody` contains `in /`

### TC-05: No type regressions
**What:** The new optional params and inline call site are type-safe

**Steps:**
1. Run `bun tsc --noEmit`

**Expected:**
- Exit code 0
- Zero TypeScript errors

### TC-06: Edge case — partial tokenUsage (no cost)
**What:** Token line renders without cost suffix when costUsd is undefined

**Steps (manual inspection):**
1. Inspect `src/lib/review-utils.ts` lines for costStr computation
2. Confirm: `const costStr = costUsd !== undefined ? \` | ${costUsd.toFixed(4)}\` : ''`

**Expected:**
- costStr is empty string when costUsd is undefined
- Output: `- Tokens: N in / M out` (no trailing `|`)

### TC-07: Edge case — partial usageLimit (no resetsAt)
**What:** Usage line renders without reset suffix when resetsAt is undefined

**Steps (manual inspection):**
1. Inspect `src/lib/review-utils.ts` resetStr computation
2. Confirm: `const resetStr = resetsAt !== undefined ? \` | resets ...\` : ''`

**Expected:**
- resetStr is empty string when resetsAt is undefined
- Output: `- Claude Code usage: N% of {type} limit` (no trailing `| resets`)


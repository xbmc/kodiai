---
id: S02
parent: M034
milestone: M034
provides:
  - formatReviewDetailsSummary accepts usageLimit and tokenUsage optional params and renders them into the Review Details section
  - review.ts call site is wired to pass result.usageLimit and result token fields
  - 3 unit tests + 1 integration test covering the happy path and omission path
requires:
  - slice: S01
    provides: result.usageLimit field on ExecutionResult populated from Claude Code rate-limit SDK events
affects:
  []
key_files:
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
key_decisions:
  - Inlined usageLimit shape in formatReviewDetailsSummary rather than importing from ExecutionResult — keeps review-utils independent of execution types
  - tokenUsage object constructed inline at the review.ts call site from result.inputTokens/outputTokens/costUsd — keeps the call site self-documenting
  - Conditional pushes inserted after initial sections array literal and before largePRTriage block — consistent with existing conditional-push pattern in the function
patterns_established:
  - Optional rendering params in formatReviewDetailsSummary follow the same conditional-push-into-sections pattern already used for largePRTriage and other conditional blocks — future additions should continue this pattern
observability_surfaces:
  - GitHub PR comment Review Details section now shows: Claude Code usage percentage and reset time (when usageLimit is present), token counts in/out and cost in USD (when tokenUsage is present)
drill_down_paths:
  - .gsd/milestones/M034/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M034/slices/S02/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-02T20:27:14.927Z
blocker_discovered: false
---

# S02: Render usage and tokens in Review Details

**Extended formatReviewDetailsSummary with optional usageLimit and tokenUsage params, wired them from review.ts, and verified end-to-end with unit + integration tests.**

## What Happened

S02 extended the Review Details GitHub comment section to surface Claude Code usage context captured by S01.

**T01** added two optional params to `formatReviewDetailsSummary` in `src/lib/review-utils.ts`:
- `usageLimit?: { utilization, rateLimitType, resetsAt }` — renders as `- Claude Code usage: {pct}% of {type} limit | resets {ISO}`
- `tokenUsage?: { inputTokens, outputTokens, costUsd }` — renders as `- Tokens: {N} in / {M} out | {cost}`

Both shapes are inlined (not imported from `ExecutionResult`) to keep review-utils independent of execution types. The conditional pushes are inserted after the initial `sections` array literal and before the `largePRTriage` block, consistent with the existing conditional-push pattern in the function. Three unit tests were created in `src/lib/review-utils.test.ts` covering: renders usage line when present, renders token line when present, omits both when absent. One minor deviation: `BASE_PARAMS` in the test file required `autoBand: null` to satisfy `ResolvedReviewProfile` — not in the plan but trivially fixed.

**T02** passed `result.usageLimit` and an inline `tokenUsage` object to the single `formatReviewDetailsSummary` call site at ~line 3004 in `src/handlers/review.ts`. The `tokenUsage` object is constructed inline (`{ inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd }`) rather than pre-formed, keeping the call site self-documenting. One integration test was added to `src/handlers/review.test.ts` asserting `detailsCommentBody` contains `80% of seven_day limit` and `in /` when the executor returns usage data.

Final verification: 3/3 unit tests pass, 73/73 handler tests pass, `bun tsc --noEmit` exits 0.

## Verification

Ran three verification commands after all tasks completed:
1. `bun test ./src/lib/review-utils.test.ts` — 3 pass, 0 fail, 8 expect() calls (30ms)
2. `bun tsc --noEmit` — exit 0, zero type errors
3. `bun test ./src/handlers/review.test.ts --timeout 60000` — 73 pass, 0 fail, 311 expect() calls (2.77s)

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

`BASE_PARAMS` in `review-utils.test.ts` required `autoBand: null` to satisfy `ResolvedReviewProfile` — not mentioned in T01 task plan but trivially resolved during implementation.

## Known Limitations

None. Both rendering conditions and their omission when absent are tested.

## Follow-ups

None. The Slack surface is explicitly out of scope for this milestone per the vision statement.

## Files Created/Modified

- `src/lib/review-utils.ts` — Added optional usageLimit and tokenUsage params to formatReviewDetailsSummary; conditional pushes render usage percentage/reset and token count/cost lines into sections array
- `src/lib/review-utils.test.ts` — New file: 3 unit tests covering renders-usage-line, renders-token-line, omits-both-when-absent
- `src/handlers/review.ts` — Wired result.usageLimit and inline tokenUsage object into formatReviewDetailsSummary call at ~line 3004
- `src/handlers/review.test.ts` — Added integration test asserting detailsCommentBody contains usage and token lines when executor returns usageLimit data

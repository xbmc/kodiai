# S02 Research: Render usage and tokens in Review Details

## Summary

Straightforward extension of an existing function and its call site. S01 already put `usageLimit` on `ExecutionResult`. This slice wires it into `formatReviewDetailsSummary()` in `src/lib/review-utils.ts` and passes it from the single call site in `src/handlers/review.ts`.

No new files. No new dependencies. The pattern to follow already exists in the same files.

---

## Implementation Landscape

### Key files

| File | Role |
|------|------|
| `src/lib/review-utils.ts` | Contains `formatReviewDetailsSummary()` — the function to extend |
| `src/handlers/review.ts` | The single call site (line ~2987); `result` is in scope |
| `src/execution/types.ts` | Already defines `ExecutionResult.usageLimit` (S01 work) |
| `src/handlers/review.test.ts` | Integration tests that assert on `detailsCommentBody` |

### `formatReviewDetailsSummary` signature (current)

```ts
export function formatReviewDetailsSummary(params: {
  reviewOutputKey: string;
  filesReviewed: number;
  linesAdded: number;
  linesRemoved: number;
  findingCounts: { critical, major, medium, minor };
  largePRTriage?: { ... };
  feedbackSuppressionCount?: number;
  keywordParsing?: ParsedPRIntent;
  profileSelection: ResolvedReviewProfile;
  authorTier?: string;
  prioritization?: { findingsScored, topScore, thresholdScore };
}): string
```

Two new optional params need to be added:
1. `usageLimit?: { utilization: number | undefined; rateLimitType: string | undefined; resetsAt: number | undefined; }` — straight from `ExecutionResult.usageLimit`
2. `tokenUsage?: { inputTokens: number | undefined; outputTokens: number | undefined; costUsd: number | undefined; }` — from `ExecutionResult` top-level fields

### The `sections` array in `formatReviewDetailsSummary`

The function builds a `sections` array and pushes into it before calling `sections.join("\n")`. New lines should be pushed after the existing `Review completed:` line and before the `keywordSection`. Exact insertion point in the function body (offset ~240–300):

```ts
// After existing fields, before keywordSection
if (usageLimit?.utilization !== undefined) {
  const pct = Math.round(usageLimit.utilization * 100);
  const type = usageLimit.rateLimitType ?? "usage";
  const resetStr = usageLimit.resetsAt !== undefined
    ? ` | resets ${new Date(usageLimit.resetsAt * 1000).toISOString()}`
    : "";
  sections.push(`- Claude Code usage: ${pct}% of ${type} limit${resetStr}`);
}
if (tokenUsage?.inputTokens !== undefined || tokenUsage?.outputTokens !== undefined) {
  const inp = tokenUsage.inputTokens ?? 0;
  const out = tokenUsage.outputTokens ?? 0;
  const costStr = tokenUsage.costUsd !== undefined
    ? ` | $${tokenUsage.costUsd.toFixed(4)}`
    : "";
  sections.push(`- Tokens: ${inp.toLocaleString()} in / ${out.toLocaleString()} out${costStr}`);
}
```

**Note:** `resetsAt` is a Unix epoch timestamp in seconds (confirmed by SDK type: `resetsAt?: number` and test usage like `resetsAt: 9999`). Multiply by 1000 for `new Date()`.

### The call site in `review.ts` (line ~2987)

`result` is in scope from `const result = await executor.execute({...})` (line ~2518). The call site already passes many optional fields. Two more need to be threaded:

```ts
const reviewDetailsBody = formatReviewDetailsSummary({
  // existing fields...
  usageLimit: result.usageLimit,          // new — optional, may be undefined
  tokenUsage: {                           // new — optional fields all from result
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  },
});
```

The type for `tokenUsage` can be defined inline in the params type or as a local type; no shared type is needed.

### Retry path

There is no second call to `formatReviewDetailsSummary` for the retry path — confirmed by `grep`. The retry path flows through `upsertReviewDetailsComment` directly without rebuilding the details body.

---

## Test Surface

### Existing tests (`review.test.ts`)

All existing executor mocks return a minimal `ExecutionResult` shape — no `usageLimit`, `inputTokens`, or `outputTokens`. The new fields are optional, so existing tests are unaffected. Their `detailsCommentBody` assertions should continue to pass.

### New tests needed

Two targeted tests covering the contract requirements (in `review.test.ts` under a new `describe` block):

1. **usageLimit rendered when present** — executor returns `result` with `usageLimit: { utilization: 0.75, rateLimitType: "seven_day", resetsAt: 1735000000 }` and token fields. Assert `detailsCommentBody` contains `75% of seven_day limit` and the reset timestamp and the token/cost line.

2. **usageLimit absent when not provided** — executor returns `result` without `usageLimit`. Assert `detailsCommentBody` does **not** contain `Claude Code usage:` or `Tokens:`. This proves graceful omission.

**Alternatively**, the unit tests can be placed against `formatReviewDetailsSummary` directly (it's a pure function) — this is cheaper to write and doesn't need the full handler harness. Given the function is already exported and pure, direct unit tests in a new `review-utils.test.ts` (or within `review.test.ts` as a describe block calling the function directly) are the right choice. The handler integration test in `review.test.ts` already proves the call site passes through; a direct unit test is cleaner for the formatter contract.

**Check:** `src/lib/review-utils.ts` has no corresponding `.test.ts` — confirmed by `find`. A new `src/lib/review-utils.test.ts` is the natural home for `formatReviewDetailsSummary` unit tests.

---

## Graceful-Omission Contract

- If `usageLimit` is undefined: no usage line appears in the output.
- If `usageLimit.utilization` is undefined but other sub-fields are defined: still no line (utilization is the primary signal — without it there's nothing useful to render).
- If `tokenUsage` fields are all undefined: no token line.
- These are pure conditional guards, no errors possible.

---

## What to Build (Task Decomposition Hint)

### T01: Extend `formatReviewDetailsSummary` and add unit tests
- Add `usageLimit?` and `tokenUsage?` params to the function signature
- Push the usage line (if utilization present) and token line (if any token field present) into `sections`
- Create `src/lib/review-utils.test.ts` with tests: renders usage line, renders token line, omits both when absent
- Verify: `bun test ./src/lib/review-utils.test.ts`

### T02: Wire `result.usageLimit` and token fields into the call site + integration test
- Pass `usageLimit: result.usageLimit` and `tokenUsage: { inputTokens, outputTokens, costUsd }` to `formatReviewDetailsSummary` in `review.ts`
- Add one integration test in `review.test.ts` asserting the usage line appears in `detailsCommentBody` when executor returns `usageLimit`
- Verify: `bun tsc --noEmit && bun test ./src/handlers/review.test.ts --timeout 60000`

---

## Constraints / Gotchas

- **`toLocaleString()` in tests:** avoid locale-dependent formatting assertions. Test token counts with `.toContain("in /")` or match on the label prefix, not the formatted number.
- **Cost formatting:** `costUsd.toFixed(4)` — 4 decimal places matches the existing `costWarningUsd` formatting in `review.ts` (line ~3119).
- **R001 (zero tsc errors):** the new optional params must have correct types matching `ExecutionResult.usageLimit`. The type is already defined in `types.ts`; import it or inline the same shape.
- **R006 (pino logger):** no logging changes needed in this slice — the function is pure.
- No new libraries. No new dependencies.

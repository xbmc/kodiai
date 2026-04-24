---
estimated_steps: 4
estimated_files: 5
skills_used:
  - using-superpowers
  - writing-plans
  - test-driven-development
  - verify-before-complete
---

# T03: Propagate the unified contract through timeout, retry-merge, and max-turns publication paths

**Slice:** S02 — Coverage and visible-state rendering
**Milestone:** M062

## Description

Update `src/handlers/review.ts` and its integration coverage so every constrained publication branch uses the unified visible-state contract. This is the branch-closure task: timeout partial publication, retry merge updates, and exhausted-`max_turns` fallback must all render the same truthful coverage and continuation story instead of slipping back to branch-local prose.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Timeout partial publication branch in `src/handlers/review.ts` | Stop and route the branch back through shared formatter helpers rather than patching strings inline. | Preserve existing bounded publication behavior and fail the test if retry-state wording becomes the only visible signal. | Treat malformed checkpoint or first-pass state as non-publishable and keep explicit failure wording rather than claiming bounded success. |
| Retry merge / max-turns fallback branches in `src/handlers/review.ts` | Keep publication identity stable and update integration tests before changing comment bodies. | N/A for unit/integration test work. | Reuse normalized first-pass state only; do not synthesize merged coverage claims from ad hoc handler calculations. |

## Load Profile

- **Shared resources**: handler publication helpers, checkpoint state, and comment-update paths keyed by `reviewOutputKey`.
- **Per-operation cost**: one render/update path per constrained branch plus existing test orchestration.
- **10x breakpoint**: branch divergence and stale bespoke strings, not raw runtime throughput.

## Negative Tests

- **Malformed inputs**: cover missing checkpoint/comment identity or non-publishable first-pass state so handlers do not publish misleading bounded wording.
- **Error paths**: exercise timeout publication plus retry merge and exhausted-`max_turns` bounded fallback to ensure every branch still routes through the unified formatter contract.
- **Boundary conditions**: assert wording when continuation is pending versus stopped and when retry results expand reviewed coverage.

## Steps

1. Trace timeout partial publication, retry merge update, and exhausted-`max_turns` fallback in `src/handlers/review.ts` to remove any remaining branch-local bounded-review prose.
2. Route those branches through the shared formatter contract established in T01/T02 while preserving the single public review identity.
3. Extend `src/handlers/review.test.ts` to assert coherent visible-state wording across timeout publication, retry-merged updates, and bounded max-turns fallback.
4. Run handler tests and `bun run tsc --noEmit` to prove the branch wiring and compile gate both stay green.

## Must-Haves

- [ ] Every constrained publication branch in `src/handlers/review.ts` uses the unified visible-state contract.
- [ ] Integration tests prove visible wording parity for timeout, retry-merge, and bounded max-turns publication paths.

## Verification

- `bun test ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: handler integration tests become the proof surface for branch-specific visible-state regressions.
- How a future agent inspects this: run `bun test ./src/handlers/review.test.ts` and inspect constrained-publication assertions keyed to timeout, retry, and max-turns cases.
- Failure state exposed: branch drift appears as concrete mismatches between published partial comment text and Review Details text.

## Inputs

- `src/handlers/review.ts` — constrained publication branches for timeout, retry merge, and exhausted turn budget.
- `src/handlers/review.test.ts` — integration coverage for visible publication outcomes.
- `src/lib/review-utils.ts` — shared Review Details formatter contract established earlier in the slice.
- `src/lib/partial-review-formatter.ts` — shared bounded comment contract consumed by handlers.
- `src/lib/review-first-pass.ts` — normalized first-pass state that branches must render instead of reinterpreting.

## Expected Output

- `src/handlers/review.ts` — constrained publication branches routed through the unified visible-state contract.
- `src/handlers/review.test.ts` — integration assertions proving coherent wording across timeout, retry-merge, and bounded max-turns paths.

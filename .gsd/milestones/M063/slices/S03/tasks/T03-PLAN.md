---
estimated_steps: 31
estimated_files: 4
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T03: Re-prove authority-safe same-surface continuation writes on the shipped retry path

Extend the real handler-path coverage so S03 proves the final same-surface continuation write path still respects publish authority after S02 collapsed continuation onto one canonical comment. Focus on the retry merge path in `src/handlers/review.ts`: canonical summary merge, nested Review Details refresh, and quiet no-delta settlement. Make the tests assert on actual public mutations and suppression logs; only touch handler code if the new assertions expose a genuine gap.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `ReviewWorkCoordinator` publish-right checks | Keep stale-authority scenarios red until the real write path rechecks authority before each public mutation. | N/A in tests; coordinator state is local and deterministic. | Treat missing supersession markers/logs as a failing regression because stale-state suppression is the contract. |
| Canonical-comment / Review Details merge path | Fail the test if either update mutates the comment after rights are lost or if quiet no-delta settlement emits public churn. | N/A for local handler tests. | Fail when the canonical comment cannot be rediscovered or when Review Details merge falls back to an unintended standalone write. |

## Load Profile

- **Shared resources**: In-memory review-work coordinator and mocked GitHub comment state inside handler tests.
- **Per-operation cost**: One queued retry flow with mocked summary lookup/update operations per scenario.
- **10x breakpoint**: Test fixture complexity and assertion brittleness, so keep scenarios narrowly scoped to final write-path guards.

## Negative Tests

- **Malformed inputs**: missing canonical comment id or malformed prior Review Details body should not mask stale-authority failures.
- **Error paths**: stale retry loses rights before summary merge, between summary merge and Review Details merge, or during quiet no-delta settlement.
- **Boundary conditions**: no-delta continuation must settle internally while leaving the canonical public surface unchanged.

## Steps

1. Audit the retry merge branch in `src/handlers/review.ts` to confirm where summary and Review Details writes are independently gated today.
2. Extend `src/handlers/review.test.ts` with explicit stale/superseded scenarios for summary merge suppression, Review Details merge suppression, and quiet no-delta no-op behavior on the canonical comment.
3. Make the tests assert on both comment mutations and publish-right suppression logs so the failure mode is diagnosable.
4. If a gap is exposed, apply the smallest handler fix that preserves S01/S02 semantics and re-run the S02 verifier as a regression guard.

## Must-Haves

- [ ] Handler coverage proves stale/superseded retry cannot update the canonical summary body.
- [ ] Handler coverage proves stale/superseded retry cannot refresh nested Review Details after losing rights.
- [ ] Quiet no-delta continuation remains a public no-op on the same visible surface.

## Verification

- `bun test src/handlers/review.test.ts --filter "retry"`
- `bun run verify:m063:s02 -- --json`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: stale-authority suppression remains visible through retry-path logs and explicit test assertions on update calls.
- How a future agent inspects this: run `bun test src/handlers/review.test.ts --filter "retry"` and inspect the stale-authority scenario names plus suppression log assertions.
- Failure state exposed: whether summary merge, Review Details merge, or quiet settlement regressed.

## Inputs

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``scripts/verify-m063-s02.ts``
- ``src/lib/partial-review-formatter.ts``
- ``src/lib/review-continuation-lifecycle.ts``

## Expected Output

- ``src/handlers/review.test.ts``
- ``src/handlers/review.ts``

## Verification

bun test src/handlers/review.test.ts --filter "retry" && bun run verify:m063:s02 -- --json && bun run tsc --noEmit

## Observability Impact

Strengthens the shipped retry-path diagnostics for stale-authority suppression on the final visible write path.

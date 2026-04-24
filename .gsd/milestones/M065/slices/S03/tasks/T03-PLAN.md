---
estimated_steps: 4
estimated_files: 4
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T03: Compose S03 into the top-level M065 verifier and keep failure drill-down mechanical

**Slice:** S03 — Fresh regression guard and operator rerun packaging
**Milestone:** M065

## Description

Replace the fresh-regression placeholder in `verify:m065` with the authoritative nested S03 report while preserving the S01/S02 composition pattern. `M065-FRESH-REGRESSION-PROOF` should now be satisfied, failed, or malformed based on `nested_reports.s03`, and the milestone report should keep pointing operators to the exact drill-down commands without changing the top-level CLI shape.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m065-s03.ts` nested report | Mark `M065-FRESH-REGRESSION-PROOF` failed and preserve S03 drill-down metadata | Bubble timeout/unavailable status into the S03 nested failure instead of silently treating it as pending | Treat malformed S03 payloads as nested contract failure rather than inventing authority |
| Existing M062/M063/M064/S02 nested reports | Preserve the current S01/S02 failure behavior and do not let a passing S03 report mask earlier failures | Existing behavior remains unchanged | Existing malformed nested-report handling remains unchanged |

## Load Profile

- **Shared resources**: composed verifier execution time and JSON report size only.
- **Per-operation cost**: one additional nested verifier evaluation plus top-level check synthesis.
- **10x breakpoint**: report-shape drift or flattened evidence if S03 is injected ad hoc instead of through the established composition pattern.

## Negative Tests

- **Malformed inputs**: injected malformed S03 report missing required fields.
- **Error paths**: S03 failing, S03 malformed, and S03 passing while S02 still fails.
- **Boundary conditions**: top-level command exits non-zero when fresh regression proof is red or malformed, and localizes the failing nested contract mechanically.

## Steps

1. Update `scripts/verify-m065.test.ts` with failing coverage for nested S03 report preservation, top-level fresh-regression check behavior, and first-failing-check selection.
2. Modify `scripts/verify-m065.ts` to evaluate or accept the S03 report as a nested authoritative payload and map it into `M065-FRESH-REGRESSION-PROOF` and `rollout_obligations.freshRegressionProof`.
3. Keep the existing M062/M063/M064/S02 composition contract intact and preserve drill-down metadata so operators can rerun the exact nested verifier next.
4. Re-run the focused verifier tests and CLI to prove `verify:m065` still localizes failure mechanically.

## Must-Haves

- [ ] `scripts/verify-m065.ts` preserves nested authoritative reports and adds S03 as a first-class nested fresh-regression payload rather than flattening it into prose.
- [ ] `scripts/verify-m065.test.ts` proves the fresh-regression slot is no longer hardcoded pending once S03 is wired.
- [ ] `M065-FRESH-REGRESSION-PROOF` now fails or satisfies from S03, while earlier prerequisite/S02 failures still win when present.

## Verification

- `bun test scripts/verify-m065.test.ts`
- `bun test scripts/verify-m065-s03.test.ts`
- `bun run verify:m065 -- --json`

## Observability Impact

- Signals added/changed: top-level fresh-regression check status, S03 nested report key, and first-failing-check selection that points directly to the S03 drill-down path.
- How a future agent inspects this: `bun run verify:m065 -- --json`.
- Failure state exposed: whether the milestone is blocked by prerequisite verifier failure, failed live proof, malformed S03 evidence, or fresh regression/package drift.

## Inputs

- `scripts/verify-m065.ts` — current S01/S02 composition verifier with fresh-regression placeholder.
- `scripts/verify-m065.test.ts` — current composed-verifier contract tests.
- `scripts/verify-m065-s03.ts` — implemented S03 verifier from T02.
- `scripts/verify-m065-s03.test.ts` — S03 coverage proving expected nested report semantics.
- `scripts/verify-m065-s02.ts` — existing live-proof verifier whose contract must remain authoritative.

## Expected Output

- `scripts/verify-m065.ts` — updated top-level verifier wiring S03 as nested fresh-regression evidence.
- `scripts/verify-m065.test.ts` — passing tests for S03 composition and failure-order behavior.

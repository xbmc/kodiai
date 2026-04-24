---
estimated_steps: 18
estimated_files: 4
skills_used:
  - using-superpowers
  - test-driven-development
  - verify-before-complete
---

# T03: Add a deterministic verifier for the automatic continuation lifecycle contract

Package the shipped S01 behavior into a machine-checkable verifier so later slices can build on a stable lifecycle proof instead of rediscovering it from `review.test.ts`. The verifier should exercise the real continuation seam and report whether bounded first-pass output automatically produces a continuation plan, whether merge/no-delta settlement decisions are explicit, and whether stale continuation loses authority before updating visible state.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/lib/review-continuation-lifecycle.ts` exports | fail the verifier loudly with named invalid-contract statuses | not applicable for local imports | reject scenarios whose planner output is missing required fields |
| `src/handlers/review.ts` continuation fixtures/helpers | surface the mismatch in the scenario issues list instead of silently skipping coverage | not applicable for local helpers | classify the scenario as invalid-contract rather than passing with partial evidence |

## Load Profile

- **Shared resources**: local Bun process only; verifier must stay deterministic and in-process
- **Per-operation cost**: a small fixed scenario matrix covering schedule, merge, no-delta, and stale-authority suppression
- **10x breakpoint**: output readability degrades before runtime cost matters, so keep report fields compact and semantic

## Negative Tests

- **Malformed inputs**: invalid scenario ids and planner outputs missing continuation status or pass identity
- **Error paths**: no-follow-up, no-delta, and stale-authority scenarios must return explicit non-success statuses instead of generic pass/fail prose
- **Boundary conditions**: single-pass merge-ready, no remaining scope, and superseded continuation after a newer attempt claims authority

## Must-Haves

- [ ] Add `scripts/verify-m063-s01.ts` with stable human-readable and `--json` output
- [ ] Reuse production continuation and handler seams instead of hand-writing parallel lifecycle logic in the verifier
- [ ] Fail deterministically when automatic continuation, merge/settlement classification, or stale-authority suppression regresses

## Inputs

- ``src/lib/review-continuation-lifecycle.ts``
- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``scripts/verify-m062-s03.ts``

## Expected Output

- ``scripts/verify-m063-s01.ts``
- ``scripts/verify-m063-s01.test.ts``

## Verification

bun test scripts/verify-m063-s01.test.ts && bun run scripts/verify-m063-s01.ts --json

## Observability Impact

Adds a compact proof surface that reports continuation-plan status, merge/settlement status, and stale-authority suppression explicitly, reducing the need to replay the full handler test file to diagnose lifecycle regressions.

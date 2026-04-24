---
estimated_steps: 4
estimated_files: 4
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T03: Wire the S02 report into `verify:m065` and keep S03 pending

**Slice:** S02 — Representative live large-PR proof
**Milestone:** M065

## Description

Replace the current S02 placeholder in the milestone verifier with the real nested `verify:m065:s02` report while preserving the S01 composition pattern. The top-level report must keep earlier M062/M063/M064 reports authoritative, expose the S02 live proof as its own nested payload and top-level rollout check, and leave `M065-FRESH-REGRESSION-PROOF` as the remaining explicit pending obligation for S03.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m065-s02.ts` nested report | Mark `M065-LIVE-LARGE-PR-PROOF` failed and preserve S02 drill-down metadata | Bubble up S02 timeout/unavailable status as the live-proof failing check | Treat malformed S02 payloads as nested contract failure rather than inventing authority |
| Existing M062/M063/M064 nested reports | Preserve the current S01 failure behavior and do not let a passing S02 report mask prerequisite failures | Existing behavior remains unchanged | Existing malformed nested-report handling remains unchanged |

## Load Profile

- **Shared resources**: composed verifier execution time and JSON report size only.
- **Per-operation cost**: one additional nested verifier evaluation plus top-level check synthesis.
- **10x breakpoint**: report-shape drift or flattened evidence if S02 is injected ad hoc instead of through the established composition pattern.

## Negative Tests

- **Malformed inputs**: injected malformed S02 report missing required fields.
- **Error paths**: S02 failing, S02 pending/unavailable, and S02 satisfied while S03 remains pending.
- **Boundary conditions**: top-level command exits 0 for valid-but-pending when only fresh regression proof is missing, but not when S02/nested prerequisite reports are malformed or failed.

## Steps

1. Update `scripts/verify-m065.test.ts` with failing coverage for nested S02 report preservation, top-level live-proof check behavior, and first-failing-check selection.
2. Modify `scripts/verify-m065.ts` to evaluate or accept the S02 report as a nested authoritative payload and map it into `M065-LIVE-LARGE-PR-PROOF`.
3. Keep the existing M062/M063/M064 composition contract intact and preserve pending-only exit semantics so S03 remains the only remaining rollout obligation when S02 passes.
4. Re-run the focused verifier tests to prove `verify:m065` still localizes failure mechanically.

## Must-Haves

- [ ] `scripts/verify-m065.ts` preserves nested authoritative reports and adds S02 as a first-class nested live-proof payload rather than flattening it into prose.
- [ ] `scripts/verify-m065.test.ts` proves the live-proof slot is no longer hardcoded pending once S02 is wired.
- [ ] `M065-FRESH-REGRESSION-PROOF` remains the next pending rollout obligation for S03 after a passing S02 report.

## Verification

- `bun test scripts/verify-m065.test.ts`
- `bun test scripts/verify-m065-s02.test.ts`
- `bun run verify:m065 -- --json`

## Observability Impact

- Signals added/changed: top-level live-proof check status, S02 nested report key, and first-failing-check selection that points directly to the S02 drill-down path.
- How a future agent inspects this: `bun run verify:m065 -- --json`.
- Failure state exposed: whether the milestone is blocked by prerequisite verifier failure, malformed S02 evidence, failed S02 live proof, or only the still-pending S03 regression proof.

## Inputs

- `scripts/verify-m065.ts` — current S01 composition verifier with pending rollout placeholders.
- `scripts/verify-m065.test.ts` — current composed-verifier contract tests.
- `scripts/verify-m065-s02.ts` — implemented S02 live-proof verifier from T02.
- `scripts/verify-m065-s02.test.ts` — S02 coverage proving expected nested report semantics.
- `package.json` — existing `verify:m065` / `verify:m065:s02` script entries.

## Expected Output

- `scripts/verify-m065.ts` — updated top-level verifier wiring S02 as nested live-proof evidence.
- `scripts/verify-m065.test.ts` — passing tests for S02 composition and remaining S03 pending behavior.

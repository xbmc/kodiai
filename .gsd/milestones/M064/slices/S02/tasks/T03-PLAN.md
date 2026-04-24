---
estimated_steps: 37
estimated_files: 6
skills_used: []
---

# T03: Add deterministic proof for orchestration failure and supersession scenarios

Close the slice with a machine-checkable proof surface that exercises the real orchestration failure paths rather than relying on ad hoc log inspection. This task packages the slice demo into a deterministic verifier/regression command that future agents can rerun when continuation-family truth looks suspicious.

## Steps
1. Add a focused verifier script and tests that drive the real handler/orchestration seams for retry enqueue failure, retry execution failure, telemetry degradation, and superseded stale retry scenarios, then read back canonical continuation-family state as the answer source.
2. Expose the verifier through `package.json` so slice-close verification can run one command after the unit suites.
3. Keep the verifier canonical-state-first: it may mention projection degradation, but it must not derive authority from checkpoint JSON or telemetry rows.

## Must-Haves
- [ ] A deterministic `verify:m064:s02` command exists and emits canonical-state answers for the slice scenarios.
- [ ] Verifier tests assert the reported authoritative attempt, outcome, stop reason, and projection status for each scenario.
- [ ] The verifier reuses tracked source/test fixtures only; no `.gsd/` or ignored-path fixtures are required.

## Verification
- `bun test scripts/verify-m064-s02.test.ts`
- `bun run verify:m064:s02 -- --json`
- `bun test src/execution/mcp/checkpoint-server.test.ts && bun test src/handlers/review.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s02 -- --json`

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| verifier scenario harness in `scripts/verify-m064-s02.ts` | Exit non-zero with scenario failure details | Treat as failed proof and report timeout in test output | Fail parsing/validation and surface scenario name + mismatch |
| canonical store/query seam used by verifier | Fail fast; verifier must not silently fall back to checkpoints or telemetry | N/A in local harness | Reject unexpected shape and fail the scenario |

## Load Profile
- **Shared resources**: local test harnesses and canonical-state fixtures only.
- **Per-operation cost**: a few scenario executions plus one canonical-state read/assert per scenario.
- **10x breakpoint**: mostly test runtime; no production hot-path load risk.

## Negative Tests
- **Malformed inputs**: verifier rejects missing/invalid canonical fields instead of printing partial success.
- **Error paths**: each orchestration-failure scenario must prove the verifier still returns a truthful canonical answer.
- **Boundary conditions**: superseded stale retry scenario must confirm older-attempt proof output cannot win after a newer attempt is authoritative.

## Inputs
- `src/handlers/review.ts` — canonical orchestration behavior under test.
- `src/handlers/review.test.ts` — scenario setup patterns for continuation-family runtime tests.
- `src/execution/mcp/checkpoint-server.ts` — truthful checkpoint acknowledgement contract from T01.
- `scripts/verify-m064-s01.ts` — prior canonical-state verifier pattern to extend, not re-derive.
- `scripts/verify-m064-s01.test.ts` — verifier test structure to mirror.
- `package.json` — script wiring surface.

## Expected Output
- `scripts/verify-m064-s02.ts` — deterministic orchestration-failure/supersession verifier.
- `scripts/verify-m064-s02.test.ts` — verifier regression coverage.
- `package.json` — `verify:m064:s02` command wiring.

## Inputs

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``src/execution/mcp/checkpoint-server.ts``
- ``scripts/verify-m064-s01.ts``
- ``scripts/verify-m064-s01.test.ts``
- ``package.json``

## Expected Output

- ``scripts/verify-m064-s02.ts``
- ``scripts/verify-m064-s02.test.ts``
- ``package.json``

## Verification

bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s02 -- --json

## Observability Impact

Creates a repeatable canonical-state-first inspection surface for future agents to diagnose whether orchestration truth is canonical, degraded, or stale.

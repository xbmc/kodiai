---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T01: Pin the M065 S03 verifier contract around fresh regression proof and rerun packaging

**Slice:** S03 — Fresh regression guard and operator rerun packaging
**Milestone:** M065

## Description

Create the dedicated `verify:m065:s03` contract before implementation drift sets in. The verifier must wrap fresh `verify:m061:regression` evidence in a milestone-style report, preserve the underlying regression gate output as nested evidence, and reserve explicit checks for runbook presence, rerun-command resolution, and package wiring. Keep `verify:m065` stable for operators: S03 should be a drill-down verifier, not a broad CLI redesign.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/phase-m061-token-regression-gate.ts` contract | Fail the contract test and pin the mismatch in `scripts/verify-m065-s03.test.ts` before implementing composition | Not applicable in unit tests | Treat as nested contract drift and require explicit wrapper validation |
| `scripts/verify-m055-s03.ts` pattern reuse | Keep the M065-specific command-resolution logic local and fail tests if copied assumptions do not fit this repo | Not applicable in unit tests | Reject unresolved command references explicitly instead of passing by omission |
| `package.json` verifier scripts | Fail package wiring tests and keep the command names pinned | Not applicable in unit tests | Surface missing scripts as package-wiring failure, not a silent skip |

## Load Profile

- **Shared resources**: CI test time and module mocking only.
- **Per-operation cost**: One new verifier entrypoint and one focused test file.
- **10x breakpoint**: Assertion drift if stable check ids or report keys are left implicit.

## Negative Tests

- **Malformed inputs**: unknown CLI flags, malformed nested regression data, and missing runbook/package metadata.
- **Error paths**: simulated regression-gate failure, unresolved command references, and missing package wiring.
- **Boundary conditions**: `--json`, `--help`, pass case, fail case, and malformed nested report case.

## Steps

1. Add `scripts/verify-m065-s03.test.ts` with failing coverage for CLI parsing, stable check ids, required report keys, invalid-arg handling, and package script wiring.
2. Scaffold `scripts/verify-m065-s03.ts` with the minimum exported types/functions needed for the tests to compile, plus usage text and a JSON-capable `main()`.
3. Wire `verify:m065:s03` into `package.json` and make the contract tests pass without yet implementing the full regression/runbook composition.
4. Keep the report centered on explicit nested proof/reporting slots so T02 can add real logic without changing the contract.

## Must-Haves

- [ ] `scripts/verify-m065-s03.test.ts` fails first and then passes with pinned stable CLI/report semantics.
- [ ] `scripts/verify-m065-s03.ts` exports the parser/evaluator/renderer/main seams T02 will implement against.
- [ ] `package.json` includes `verify:m065:s03` wired to `bun scripts/verify-m065-s03.ts`.

## Verification

- `bun test scripts/verify-m065-s03.test.ts`
- `bun test scripts/verify-m065-s03.test.ts --filter "parse args"`

## Observability Impact

- Signals added/changed: a dedicated S03 proof surface with stable top-level check ids and nested report keys.
- How a future agent inspects this: `bun run verify:m065:s03 -- --help` and `bun test scripts/verify-m065-s03.test.ts`.
- Failure state exposed: contract drift in CLI args, report keys, and package script wiring.

## Inputs

- `scripts/phase-m061-token-regression-gate.ts` — existing fresh regression gate to wrap rather than redesign.
- `scripts/verify-m055-s03.ts` — pattern for machine-checking runbook command references.
- `scripts/verify-m065.ts` — top-level rollout obligation and nested-verifier composition pattern.
- `package.json` — existing verifier script wiring conventions.

## Expected Output

- `scripts/verify-m065-s03.ts` — new verifier entrypoint with pinned exported contract.
- `scripts/verify-m065-s03.test.ts` — failing-then-passing contract coverage for S03 CLI/report semantics.
- `package.json` — new `verify:m065:s03` script entry.

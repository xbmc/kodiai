---
estimated_steps: 6
estimated_files: 4
skills_used:
  - using-superpowers
  - test-driven-development
  - verify-before-complete
---

# T02: Lock the verifier contract with regression tests and script wiring

Add targeted Bun tests and package wiring so the new verifier becomes a stable regression gate instead of an ad hoc script. Keep assertions semantic: verify scenario classifications, parity signals, zero-evidence rejection, single-scenario targeting, JSON shape, and package script registration without snapshotting whole comment bodies.

Steps:
1. Create `scripts/verify-m062-s03.test.ts` following the existing verifier-test style in `scripts/verify-m062-s01.test.ts`.
2. Add tests for the default matrix, `--scenario` targeting, human-readable rendering, JSON output shape, bounded-surface parity checks, and the zero-evidence negative path.
3. Wire `verify:m062:s03` into `package.json` so operators can run the verifier with the same pattern as other milestone scripts.
4. Keep assertions tied to production semantics (reason labels, coverage counts, continuation wording, bounded-comment eligibility) rather than brittle full-body snapshots.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m062-s03.ts` CLI/report contract | keep the tests failing until the contract is corrected instead of weakening assertions | not applicable for local tests | assert the JSON/human report shape is invalid and name the missing field |
| `package.json` script wiring | fail the package wiring test and block slice verification | not applicable | reject missing or incorrect script command explicitly |

## Load Profile

- **Shared resources**: test runner process and module cache only
- **Per-operation cost**: targeted Bun unit tests over one verifier module and one package manifest read
- **10x breakpoint**: brittle assertions would become the first maintenance cost, so keep tests semantic rather than snapshot-heavy

## Negative Tests

- **Malformed inputs**: unknown `--scenario`, malformed verifier report shape, missing package script
- **Error paths**: zero-evidence scenario cannot render bounded public output
- **Boundary conditions**: single-scenario execution and full-matrix execution both stay deterministic

## Inputs

- ``scripts/verify-m062-s03.ts``
- ``scripts/verify-m062-s01.test.ts``
- ``package.json``

## Expected Output

- ``scripts/verify-m062-s03.test.ts``
- ``package.json``

## Must-Haves

- [ ] Cover default-matrix, single-scenario, JSON, human-readable, and zero-evidence negative paths
- [ ] Keep assertions semantic around reason, coverage, continuation, and eligibility
- [ ] Wire `verify:m062:s03` in `package.json`

## Verification

bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts

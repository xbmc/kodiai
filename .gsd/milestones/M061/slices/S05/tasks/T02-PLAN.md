---
estimated_steps: 23
estimated_files: 16
skills_used: []
---

# T02: Pin the M061 regression gate for mention, review, retrieval, and reporting behavior

## Description
Add a separate regression gate CLI that runs the exact suite set protecting small/normal behavior while token-efficiency proof evolves. Keeping this separate from the live-telemetry verifier ensures DB-unavailable environments still have a meaningful blocking gate for R069.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `bun test` suite execution | Mark the named gate check failed with captured status/stdout/stderr | Surface timeout/non-zero status in the check detail and keep evaluating remaining pinned suites | Treat unexpected command results as failures with explicit command output |
| Test file inventory | Fail the gate test expectations if pinned paths drift or disappear | N/A | Treat missing files/commands as blocking regression failures |

## Load Profile
- **Shared resources**: local test runner process execution and any shared fixture/runtime state those tests use.
- **Per-operation cost**: one spawned `bun test` process per pinned suite group.
- **10x breakpoint**: total CI/runtime duration rises with suite count, so the gate should group tests intentionally and keep output concise.

## Negative Tests
- **Malformed inputs**: help mode, missing executable in a suite definition, and empty command definitions.
- **Error paths**: non-zero suite status and thrown spawn errors.
- **Boundary conditions**: one failing suite among many, all suites passing, and renderer output listing stable failing check IDs.

## Steps
1. Add `scripts/phase-m061-token-regression-gate.ts` following the stable Phase 80 gate pattern with M061-specific pinned suite IDs and commands.
2. Pin the mention, review, retrieval, and reporting/verifier suite groups called out in S05 research so the gate protects publication semantics and canonical proof surfaces together.
3. Add `scripts/phase-m061-token-regression-gate.test.ts` for pass/fail/help behavior and stable check rendering.

## Must-Haves
- [ ] The regression gate is separate from live telemetry proof and still works when Postgres is unavailable.
- [ ] Stable check IDs make it obvious which suite group regressed.
- [ ] The pinned suites include mention, review, retrieval, usage-report, and M061 verifier coverage rather than only unit tests for one subsystem.

## Inputs

- ``scripts/phase80-slack-regression-gate.ts``
- ``src/execution/mention-context.test.ts``
- ``src/execution/mention-prompt.test.ts``
- ``src/handlers/mention.test.ts``
- ``src/execution/review-prompt.test.ts``
- ``src/handlers/review.test.ts``
- ``src/knowledge/retrieval.test.ts``
- ``src/knowledge/retrieval.e2e.test.ts``
- ``src/knowledge/multi-query-retrieval.test.ts``
- ``scripts/usage-report.test.ts``
- ``scripts/verify-m061-s01.test.ts``
- ``scripts/verify-m061-s02.test.ts``
- ``scripts/verify-m061-s03.test.ts``
- ``scripts/verify-m061-s04.test.ts``

## Expected Output

- ``scripts/phase-m061-token-regression-gate.ts``
- ``scripts/phase-m061-token-regression-gate.test.ts``

## Verification

bun test scripts/phase-m061-token-regression-gate.test.ts && bun scripts/phase-m061-token-regression-gate.ts

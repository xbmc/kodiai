---
estimated_steps: 5
estimated_files: 6
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T02: Implement fresh-regression wrapper logic and machine-checkable M065 rollout runbook packaging

**Slice:** S03 — Fresh regression guard and operator rerun packaging
**Milestone:** M065

## Description

Implement the S03 verifier by reusing `evaluateRegressionGateChecks(...)` instead of parsing text output, then add one M065-specific runbook that tells operators how to start from `deliveryId` / `reviewOutputKey`, rerun `verify:m065`, and drill into failing nested contracts. To avoid prose-only closeout, make the S03 verifier check the runbook file exists and that every referenced `bun run ...` command resolves to a real package script or tracked TypeScript file.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/phase-m061-token-regression-gate.ts` evaluation | Return an S03 verifier failure that preserves which regression suites failed | Bubble timeout/error detail into the wrapper issue list and mark the regression check failed | Treat malformed gate output as nested-contract failure rather than inventing a pass |
| `docs/runbooks/review-requested-debug.md` / `docs/runbooks/recent-review-audit.md` conventions | Reuse only the stable rerun/drill-down rules already established there | Not applicable for docs reads | Keep M065-specific instructions explicit if the older runbooks do not already cover them |
| `package.json` / runbook command references | Fail the packaging check if a referenced command cannot be resolved to a tracked file or script | Not applicable | Report the exact unresolved command and runbook path |

## Load Profile

- **Shared resources**: local Bun test execution and markdown command-resolution only.
- **Per-operation cost**: one wrapped regression gate run plus runbook/package inspection.
- **10x breakpoint**: repeated test-suite execution time if the wrapper re-runs more regression suites than the existing pinned gate.

## Negative Tests

- **Malformed inputs**: missing runbook, unresolved `bun run` references, malformed nested regression-gate output.
- **Error paths**: one pinned regression suite failing, package script missing, and runbook using unsupported reviewer-request wording.
- **Boundary conditions**: passing regression gate with passing docs/package checks, failing regression gate with intact docs, and passing regression gate with docs drift.

## Steps

1. Extend `scripts/verify-m065-s03.test.ts` with failing coverage for wrapped regression pass/fail states, nested gate preservation, runbook presence, command-reference resolution, and package wiring.
2. Implement `scripts/verify-m065-s03.ts` so it calls `evaluateRegressionGateChecks(...)`, emits a normal milestone-style report, and preserves the raw regression-gate payload under a stable nested key.
3. Write `docs/runbooks/m065-rollout-proof.md` covering the supported manual rerun trigger, `deliveryId -> reviewOutputKey` identity capture order, `verify:m065` / `verify:m065:s02` / `verify:m065:s03` commands, and nested drill-down mapping.
4. Reuse the runbook-command-resolution idea from `verify-m055-s03.ts`, but keep it M065-specific and avoid assumptions about `docs/INDEX.md`.
5. Re-run the focused tests and CLI to prove the wrapper and packaging fail loudly on drift.

## Must-Haves

- [ ] The wrapper embeds raw regression-gate results under a stable nested key instead of parsing human text.
- [ ] The runbook preserves the supported manual rerun rule: explicit PR-scoped `@kodiai review`, not team reviewer requests.
- [ ] The runbook names the top-level and nested verifier commands operators need for live-proof and fresh-regression drill-down.
- [ ] Command-reference validation fails loudly if docs drift from package wiring.

## Verification

- `bun test scripts/verify-m065-s03.test.ts`
- `bun run verify:m065:s03 -- --json`

## Observability Impact

- Signals added/changed: S03 JSON report now distinguishes regression-gate failure from rerun-packaging drift.
- How a future agent inspects this: `bun run verify:m065:s03 -- --json` and `docs/runbooks/m065-rollout-proof.md`.
- Failure state exposed: exact failing regression suite ids, missing runbook/package assets, and unresolved command references.

## Inputs

- `scripts/verify-m065-s03.ts` — scaffolded verifier contract from T01.
- `scripts/verify-m065-s03.test.ts` — contract coverage to extend with real behavior.
- `scripts/phase-m061-token-regression-gate.ts` — authoritative regression gate functions and stable `M061-REG-*` ids.
- `docs/runbooks/review-requested-debug.md` — supported rerun trigger and `deliveryId` / `reviewOutputKey` evidence flow.
- `docs/runbooks/recent-review-audit.md` — report-field-first and nested drill-down runbook style.
- `package.json` — command resolution target for runbook packaging checks.

## Expected Output

- `scripts/verify-m065-s03.ts` — implemented S03 verifier wrapping fresh regression proof and runbook/package checks.
- `scripts/verify-m065-s03.test.ts` — passing tests for regression wrapper and packaging drift behavior.
- `docs/runbooks/m065-rollout-proof.md` — M065-specific operator rerun and drill-down runbook.

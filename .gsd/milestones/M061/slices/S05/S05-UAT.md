# S05: Integrated Token-Reduction Proof and Regression Gate — UAT

**Milestone:** M061
**Written:** 2026-04-24T03:37:50.209Z

# UAT: S05 Integrated Token-Reduction Proof and Regression Gate

## Preconditions
- Repository is at the S05-complete state.
- Bun dependencies are installed.
- Optional for live-proof mode: Postgres telemetry used by `scripts/usage-report.ts` is reachable and contains representative `mention.response` and `review.full` events.
- For local/no-DB validation, leave Postgres unavailable to confirm fail-open behavior.

## Test Case 1 — Operator can discover the full M061 proof surface
1. Run `bun run verify:m061:s03 --json`.
   - Expected: command exists via `package.json`; it returns JSON rather than a missing-script error.
2. Run `bun run verify:m061:s04 --json`.
   - Expected: command exists via `package.json`; it returns JSON rather than a missing-script error.
3. Run `bun run verify:m061:s05 --json`.
   - Expected: command exists via `package.json`; it returns JSON rather than a missing-script error.
4. Run `bun run verify:m061:regression`.
   - Expected: command exists via `package.json`; it executes the regression gate and prints stable `M061-REG-*` check IDs.

## Test Case 2 — Integrated verifier fails open truthfully when telemetry is unavailable
1. Ensure Postgres is unreachable or unset for the verifier.
2. Run `bun scripts/verify-m061-s05.ts --json`.
   - Expected: exit code 0 with `preflight.databaseAccess: "unavailable"` and a concrete detail such as connection failure.
   - Expected: `overallPassed` is false because live telemetry proof was not available.
   - Expected: output remains structured JSON and includes `M061-S05-PREFLIGHT`; it does not hang, crash, or claim PASS.
3. Confirm `observed.representativeDeliveries.mention` and `.review` are `null` in this mode.
   - Expected: absence of telemetry is explicit and does not masquerade as proof evidence.

## Test Case 3 — Regression gate protects small/normal mention and review behavior without DB access
1. Run `bun scripts/phase-m061-token-regression-gate.ts`.
   - Expected: mention, review, retrieval, reporting, and verifier suite groups each report `PASS` with stable IDs:
     - `M061-REG-MENTION-01`
     - `M061-REG-REVIEW-01`
     - `M061-REG-RETRIEVAL-01`
     - `M061-REG-REPORTING-01`
     - `M061-REG-VERIFIERS-01`
2. Confirm the final line reports `Final verdict: PASS`.
   - Expected: the gate remains useful even when Postgres is unavailable.

## Test Case 4 — Pinned regression suites still pass as one blocking contract
1. Run `bun test scripts/usage-report.test.ts scripts/verify-m061-s01.test.ts scripts/verify-m061-s02.test.ts scripts/verify-m061-s03.test.ts scripts/verify-m061-s04.test.ts scripts/verify-m061-s05.test.ts scripts/phase-m061-token-regression-gate.test.ts`.
   - Expected: all verifier/reporting/gate tests pass.
2. Run `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts src/execution/review-prompt.test.ts src/handlers/review.test.ts src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts`.
   - Expected: all mention/review/retrieval suites pass, demonstrating that token-efficiency work preserved grounding and publication behavior on normal paths.

## Test Case 5 — Tooling hygiene remains clean
1. Run `bun run lint`.
   - Expected: exit code 0 with no lint violations.

## Edge Cases
- Invalid or missing telemetry must produce explicit preflight/check failure detail rather than a crash or false PASS.
- Local or CI environments without Postgres must still be able to run the regression gate successfully.
- If any pinned suite regresses, the regression gate output should name the failing `M061-REG-*` check directly so operators know which behavior surface broke.

# S03: Fresh regression guard and operator rerun packaging

**Goal:** Require fresh non-large regression proof and operator-rerun packaging before M065 can close, while preserving the nested authoritative verifier pattern established by S01/S02.
**Demo:** The final M065 surface fails when fresh non-large regression evidence is missing or red, and the runbook shows an operator how to rerun `verify:m065`, start from `reviewOutputKey`/delivery IDs, and drill into the failing nested contract without log archaeology.

## Must-Haves

- `bun test scripts/verify-m065-s03.test.ts` passes and pins a dedicated S03 report that wraps fresh `verify:m061:regression` results, preserves nested gate evidence, and machine-checks the M065 rollout runbook command references.
- `bun test scripts/verify-m065.test.ts` passes with `M065-FRESH-REGRESSION-PROOF` sourced from authoritative `nested_reports.s03` rather than a hardcoded pending placeholder, while failure localization still prefers malformed/failed nested contracts over pending rollout state.
- `bun run verify:m065:s03 -- --json` emits a machine-readable report that distinguishes fresh regression success/failure from missing or drifting operator rerun packaging.
- `bun run verify:m065 -- --json` now fails when fresh regression proof is red or malformed and leaves operators with direct drill-down to `verify:m065:s03`, `verify:m065:s02`, and the documented `deliveryId -> reviewOutputKey -> nested verifier` rerun path.

## Proof Level

- This slice proves: This slice proves: final-assembly
Real runtime required: no
Human/UAT required: no

## Integration Closure

Upstream surfaces consumed: `scripts/phase-m061-token-regression-gate.ts`, `scripts/verify-m065.ts`, `scripts/verify-m065-s02.ts`, `docs/runbooks/review-requested-debug.md`, `docs/runbooks/recent-review-audit.md`, `package.json`
New wiring introduced in this slice: a dedicated `verify:m065:s03` verifier that wraps fresh regression evidence plus machine-checkable rerun packaging, and top-level `verify:m065` composition of that S03 nested report.
What remains before the milestone is truly usable end-to-end: capture one passing live representative proof in an operator-available environment and run the final milestone verifier there; the code/docs surface itself should be complete after this slice.

## Verification

- Runtime signals: `verify:m065:s03 -- --json` exposes stable S03 check ids, nested regression-gate results, runbook/package drift findings, and direct drill-down commands.
- Inspection surfaces: `bun run verify:m065 -- --json`, `bun run verify:m065:s03 -- --json`, and the M065 rollout runbook under `docs/runbooks/`.
- Failure visibility: top-level M065 report localizes fresh-regression failures to `nested_reports.s03`, while the S03 report localizes whether the blocker is red regression suites, malformed wrapper output, unresolved runbook command references, or missing package wiring.
- Redaction constraints: operator docs may mention `reviewOutputKey`, `deliveryId`, and repo identity, but must not instruct operators to infer truth from raw logs or expose secrets.

## Tasks

- [x] **T01: Pin the M065 S03 verifier contract around fresh regression proof and rerun packaging** `est:75m`
  Create the dedicated `verify:m065:s03` contract before implementation drift sets in. The verifier must wrap fresh `verify:m061:regression` evidence in a milestone-style report, preserve the underlying regression gate output as nested evidence, and reserve explicit checks for runbook presence, rerun-command resolution, and package wiring. Keep `verify:m065` stable for operators: S03 should be a drill-down verifier, not a broad CLI redesign.

Must-haves:
- Stable `M065-S03-*` check ids are pinned in tests.
- The report distinguishes regression-gate failure from docs/package drift.
- `package.json` exposes `verify:m065:s03`.
- The contract leaves room for a dedicated M065 rollout runbook path without flattening nested M061 evidence.
  - Files: `scripts/verify-m065-s03.ts`, `scripts/verify-m065-s03.test.ts`, `package.json`
  - Verify: bun test scripts/verify-m065-s03.test.ts

- [x] **T02: Implement fresh-regression wrapper logic and machine-checkable M065 rollout runbook packaging** `est:105m`
  Implement the S03 verifier by reusing `evaluateRegressionGateChecks(...)` instead of parsing text output, then add one M065-specific runbook that tells operators how to start from `deliveryId` / `reviewOutputKey`, rerun `verify:m065`, and drill into failing nested contracts. To avoid prose-only closeout, make the S03 verifier check the runbook file exists and that every referenced `bun run ...` command resolves to a real package script or tracked TypeScript file.

Must-haves:
- The wrapper embeds raw regression-gate results under a stable nested key.
- The runbook preserves the supported manual rerun rule: explicit PR-scoped `@kodiai review`, not team reviewer requests.
- The runbook names the top-level and nested verifier commands operators need for live-proof and fresh-regression drill-down.
- Command-reference validation fails loudly if docs drift from package wiring.
  - Files: `scripts/verify-m065-s03.ts`, `scripts/verify-m065-s03.test.ts`, `docs/runbooks/m065-rollout-proof.md`, `docs/runbooks/review-requested-debug.md`, `docs/runbooks/recent-review-audit.md`, `package.json`
  - Verify: bun test scripts/verify-m065-s03.test.ts && bun run verify:m065:s03 -- --json

- [x] **T03: Compose S03 into the top-level M065 verifier and keep failure drill-down mechanical** `est:75m`
  Replace the fresh-regression placeholder in `verify:m065` with the authoritative nested S03 report while preserving the S01/S02 composition pattern. `M065-FRESH-REGRESSION-PROOF` should now be satisfied, failed, or malformed based on `nested_reports.s03`, and the milestone report should keep pointing operators to the exact drill-down commands without changing the top-level CLI shape.

Must-haves:
- `nested_reports.s03` is preserved verbatim in the top-level report.
- `rollout_obligations.freshRegressionProof` is sourced from S03 rather than a hardcoded pending slot.
- Failure-order semantics still prefer malformed nested reports, then failed nested verifiers, then any truly pending obligations.
- The human-readable report and JSON output both tell operators which nested contract to rerun next.
  - Files: `scripts/verify-m065.ts`, `scripts/verify-m065.test.ts`, `scripts/verify-m065-s03.ts`, `scripts/verify-m065-s03.test.ts`
  - Verify: bun test scripts/verify-m065.test.ts && bun test scripts/verify-m065-s03.test.ts && bun run verify:m065 -- --json

## Files Likely Touched

- scripts/verify-m065-s03.ts
- scripts/verify-m065-s03.test.ts
- package.json
- docs/runbooks/m065-rollout-proof.md
- docs/runbooks/review-requested-debug.md
- docs/runbooks/recent-review-audit.md
- scripts/verify-m065.ts
- scripts/verify-m065.test.ts

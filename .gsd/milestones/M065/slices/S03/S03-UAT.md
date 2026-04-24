# S03: S03 — UAT

**Milestone:** M065
**Written:** 2026-04-24T09:48:49.413Z

# S03 UAT — Fresh regression guard and rerun packaging

## Preconditions
- Repo is at the S03 closeout state with `package.json`, `scripts/verify-m065.ts`, `scripts/verify-m065-s03.ts`, and `docs/runbooks/m065-rollout-proof.md` present.
- Bun dependencies are installed.
- No manual editing of generated summary/UAT artifacts is required; this UAT validates the shipped verifier and runbook surfaces.

## Test Case 1 — Fresh regression proof is independently green
1. Run `bun run verify:m065:s03 -- --json`.
2. Confirm exit code is `0`.
3. Confirm JSON contains `status_code: "m065_s03_ok"`.
4. Confirm `checks` contains:
   - `M065-S03-FRESH-REGRESSION-EVIDENCE` with `fresh_regression_ok`
   - `M065-S03-RUNBOOK-PRESENCE` with `runbook_present`
   - `M065-S03-RERUN-COMMAND-RESOLUTION` with `rerun_commands_resolved`
   - `M065-S03-PACKAGE-WIRING` with `package_wiring_ok`
5. Confirm `nested_reports.regression_gate.checks[*].id` preserves the underlying `M061-REG-*` suite ids.

**Expected outcome:** S03 passes without consulting prose-only evidence, and the wrapped regression payload stays available for drill-down.

## Test Case 2 — Top-level milestone report consumes S03 authority
1. Run `bun run verify:m065 -- --json`.
2. Confirm the command may still exit non-zero if live proof is unavailable.
3. Inspect the JSON and confirm:
   - `nested_reports.s03.command === "verify:m065:s03"`
   - `checks` contains `M065-FRESH-REGRESSION-PROOF` with `status_code: "rollout_obligation_satisfied"`
   - `checks` contains `M065-FRESH-REGRESSION-PROOF.drill_down.command === "bun run verify:m065:s03 -- --json"`
   - `rollout_obligations.freshRegressionProof.source === "nested_reports.s03"`
4. Confirm any failing milestone state still points to `M065-LIVE-LARGE-PR-PROOF`, not back to fresh regression packaging.

**Expected outcome:** Fresh regression proof is satisfied from authoritative S03 nested evidence even when the separate live large-PR proof remains red.

## Test Case 3 — Runbook gives mechanical rerun flow
1. Open `docs/runbooks/m065-rollout-proof.md`.
2. Verify it states the only supported manual rerun trigger is explicit PR-scoped `@kodiai review`.
3. Verify it lists the exact rerun commands:
   - `bun run verify:m065 -- --json`
   - `bun run verify:m065:s02 -- --json`
   - `bun run verify:m065:s03 -- --json`
   - `bun run verify:m061:regression`
4. Verify the drill-down map tells operators to inspect `nested_reports.s02` for live-proof failures and `nested_reports.s03` / `nested_reports.s03.nested_reports.regression_gate` for fresh-regression failures.

**Expected outcome:** An operator can rerun from `deliveryId`/`reviewOutputKey` into the correct nested contract without relying on raw log archaeology.

## Test Case 4 — Live-proof blocker remains localized, not masked
1. Run `bun run verify:m065 -- --json` in the current unattended environment.
2. Confirm `failing_check_id === "M065-LIVE-LARGE-PR-PROOF"`.
3. Confirm the nested S02 report still exposes the specific blocker classes under `nested_reports.s02`.
4. Confirm `M065-FRESH-REGRESSION-PROOF` remains satisfied at the same time.

**Expected outcome:** S03 completion does not hide or flatten the live-proof blocker; it only removes the fresh-regression packaging uncertainty.

## Edge Cases
- If Postgres/canonical operator access is unavailable during nested operator lookup, the composed report should degrade to `lookup-unavailable` inside `nested_reports.s02.nested_reports.operatorEvidence.records[0].statusCode` instead of throwing.
- If GitHub API access for the representative live sample is unavailable, the top-level failure must remain attributable to `nested_reports.s02`, not to S03.
- If the rollout runbook or script wiring drifts in a future change, `verify:m065:s03 -- --json` should fail before milestone closeout can silently proceed.

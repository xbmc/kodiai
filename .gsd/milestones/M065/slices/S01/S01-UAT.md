# S01: S01 — UAT

**Milestone:** M065
**Written:** 2026-04-24T08:36:33.323Z

# UAT — M065 / S01 composed rollout verifier

## Preconditions
- Repository is on the M065 S01 code with `scripts/verify-m065.ts`, `scripts/verify-m065.test.ts`, and `package.json` wiring present.
- Prior milestone verifier scripts `verify:m062:s03`, `verify:m063:s03`, and `verify:m064:s03` are available in the workspace.
- Bun is installed and project dependencies are available.

## Test Case 1 — Run the composed verifier from package.json
1. Run `bun run verify:m065 -- --json`.
2. Confirm the command exits with status 0.
3. Confirm the JSON includes `command: "verify:m065"` and `status_code: "m065_rollout_proof_pending"`.
4. Confirm `check_ids` contains exactly:
   - `M065-M062-PREREQUISITE`
   - `M065-M063-PREREQUISITE`
   - `M065-M064-PREREQUISITE`
   - `M065-LIVE-LARGE-PR-PROOF`
   - `M065-FRESH-REGRESSION-PROOF`

Expected result:
- The verifier runs from stable package wiring and returns one milestone-level report without pretending that rollout proof is complete.

## Test Case 2 — Confirm nested evidence is preserved, not flattened
1. In the JSON from Test Case 1, inspect `nested_reports.m062`, `nested_reports.m063`, and `nested_reports.m064`.
2. Verify each nested report preserves its original report payload and nested status code.
3. Verify the top-level checks for the three prerequisites have `status_code: "nested_report_ok"` and drill-down commands pointing to the corresponding nested verifier.

Expected result:
- Operators can drill directly into the authoritative nested verifier output instead of reading a flattened milestone summary.

## Test Case 3 — Confirm pending rollout obligations stay explicit
1. In the same JSON output, inspect `checks` for `M065-LIVE-LARGE-PR-PROOF` and `M065-FRESH-REGRESSION-PROOF`.
2. Verify both checks are marked `skipped: true` with pending status codes.
3. Inspect `rollout_obligations.liveLargePrProof` and `rollout_obligations.freshRegressionProof`.
4. Verify each obligation has `state: "pending"`, a null `source`, descriptive `detail`, and a `drill_down_command`.

Expected result:
- Missing S02/S03 evidence is visible as structured pending work rather than being omitted or misreported as success.

## Test Case 4 — Human-readable drill-down stays actionable
1. Run `bun run verify:m065` without `--json`.
2. Confirm the output shows the overall status, failing check id, per-prerequisite nested verifier state, and a next drill-down command for each top-level check.

Expected result:
- An operator can identify the failing or pending contract and the next command to run without reading source code.

## Edge Case — Contract regression protection
1. Run `bun test scripts/verify-m065.test.ts`.
2. Confirm the suite passes.
3. Review the named tests covering malformed nested reports and nested verifier failures.

Expected result:
- The slice keeps failing loudly if future edits flatten nested authority, remove stable check ids, or hide pending rollout obligations.

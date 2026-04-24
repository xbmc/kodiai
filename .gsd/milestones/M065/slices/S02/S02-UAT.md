# S02: Representative live large-PR proof — UAT

**Milestone:** M065
**Written:** 2026-04-24T09:08:57.744Z

# S02 UAT — Representative live large-PR proof

## Preconditions
- Repository checkout contains the S02 verifier wiring in `scripts/verify-m065-s02.ts` and `scripts/verify-m065.ts`.
- Bun dependencies are installed.
- For the live proof path, the operator has a captured large-PR `reviewOutputKey` and optionally the expected repo/delivery identity.
- Live Azure/GitHub/operator evidence may be absent in unattended environments; when absent, the expected result is a truthful failing JSON report, not a green pass.

## Test Case 1 — Dedicated verifier contract stays stable
1. Run `bun test scripts/verify-m065-s02.test.ts`.
   - Expected: 16 tests pass.
2. Confirm the suite includes checks for malformed/missing args, repo and delivery mismatches, malformed nested reports, runtime/visible/operator proof failures, retry-key normalization, and representative-bundle sufficiency.
   - Expected: stable S02 check ids remain `M065-S02-IDENTITY-CORRELATION`, `M065-S02-RUNTIME-TIMING-EVIDENCE`, `M065-S02-VISIBLE-REVIEW-PROOF`, `M065-S02-CANONICAL-OPERATOR-EVIDENCE`, and `M065-S02-REPRESENTATIVE-LIVE-BUNDLE`.

## Test Case 2 — Top-level verifier preserves authoritative S02 drill-down
1. Run `bun test scripts/verify-m065.test.ts`.
   - Expected: 9 tests pass.
2. Confirm the suite proves `verify:m065` stores the live-proof report under `nested_reports.s02` and maps it to `M065-LIVE-LARGE-PR-PROOF` without flattening nested authority.
   - Expected: when S02 succeeds in the test harness, `M065-FRESH-REGRESSION-PROOF` is the only pending obligation.

## Test Case 3 — Operator runs the dedicated live-proof verifier with a captured key
1. Run:
   `bun run verify:m065:s02 -- --review-output-key <captured-review-output-key> --repo <owner/repo> --json`
2. Inspect the JSON output.
   - Expected on success: `command: "verify:m065:s02"`, `status_code: "m065_s02_ok"`, `proof_target` populated from the base identity, and nested reports present for runtime timing, visible review proof, and canonical operator evidence.
   - Expected on failure: exit code 1 with machine-readable `failing_check_id`, stable check ids, preserved nested reports, and explicit issues explaining which subproof failed.
3. If a retry-suffixed key is used, inspect `normalized_review_output_key` and `proof_target.base_review_output_key`.
   - Expected: both normalize to the canonical base `reviewOutputKey`.

## Test Case 4 — Operator reruns the milestone verifier and drills into S02
1. Run `bun run verify:m065 -- --json`.
2. Inspect the top-level result.
   - Expected: `nested_reports.s02` is present and `M065-LIVE-LARGE-PR-PROOF` points to `bun run verify:m065:s02 -- --json` for drill-down.
3. If S02 proof succeeds, inspect rollout obligations.
   - Expected: `liveLargePrProof.state` is `satisfied` and `freshRegressionProof.state` remains `pending` until S03 lands.
4. If S02 proof fails, inspect `checks` and `nested_reports.s02`.
   - Expected: the failing status is localized to the specific nested contract instead of being flattened into a generic milestone failure.

## Edge Cases
- Missing `--review-output-key`:
  - Expected: `m065_s02_invalid_arg` with a clear issue message.
- Malformed `--review-output-key`:
  - Expected: `m065_s02_invalid_arg` before any nested evidence lookup.
- Mismatched `--delivery-id` or `--repo`:
  - Expected: invalid-arg failure with explicit mismatch text.
- Missing Azure/GitHub/operator evidence for the captured sample:
  - Expected: non-zero exit with nested runtime/visible/operator failure details, not a false success.
- Duplicate or wrong-surface visible GitHub artifacts:
  - Expected: `M065-S02-VISIBLE-REVIEW-PROOF` and/or `M065-S02-REPRESENTATIVE-LIVE-BUNDLE` fail explicitly.
- Pending/degraded/superseded canonical operator states:
  - Expected: operator evidence is preserved but the representative bundle remains insufficient.

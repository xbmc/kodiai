# M065 Rollout Proof Runbook

Use this runbook when M065 closeout is blocked on fresh non-large regression proof or on rollout-package drift. Start from machine-checkable report fields, not raw log archaeology.

## Supported manual rerun trigger

The only supported manual rerun trigger is an explicit PR-scoped `@kodiai review` comment. Do not use team reviewer requests as manual rerun evidence; reviewer-request deliveries remain debug-only context.

## Identity capture order

Capture the same run in this order so later drill-down stays correlated:

1. Capture the delivery-scoped `deliveryId` from the triggering GitHub delivery / evidence bundle.
2. Capture the matching `reviewOutputKey` from the same evidence bundle or completion surface.
3. Carry both identifiers into any follow-up investigation so the live large-PR proof and fresh-regression proof stay tied to the same rollout story.

## Machine-checkable rerun commands

- Top-level M065 closure proof: `bun run verify:m065 -- --json`
- Representative live large-PR proof: `bun run verify:m065:s02 -- --json`
- Fresh regression proof and rollout packaging: `bun run verify:m065:s03 -- --json`
- Fresh non-large regression suites: `bun run verify:m061:regression`

## Drill-down map

Start at the top-level report and only drill into the nested contract that failed:

- `rollout_obligations.liveLargePrProof` / `nested_reports.s02`
  - use when M065 is blocked on representative live large-PR proof
  - rerun: `bun run verify:m065:s02 -- --json`
- `rollout_obligations.freshRegressionProof` / `nested_reports.s03`
  - use when M065 is blocked on fresh non-large regression proof or rollout-package drift
  - rerun: `bun run verify:m065:s03 -- --json`
- `nested_reports.s03.nested_reports.regression_gate`
  - use when S03 says the wrapped regression gate is red or malformed
  - rerun: `bun run verify:m061:regression`

## Failure interpretation

### `verify:m065 -- --json`

- `status_code=m065_rollout_proof_pending`
  - M065 is still waiting on one of the rollout obligations.
- `failing_check_id=M065-FRESH-REGRESSION-PROOF`
  - inspect `nested_reports.s03` first.
- `failing_check_id=M065-LIVE-LARGE-PR-PROOF`
  - inspect `nested_reports.s02` first.

### `verify:m065:s03 -- --json`

- `status_code=m065_s03_verifier_failed` with `failing_check_id=M065-S03-FRESH-REGRESSION-EVIDENCE`
  - the authoritative non-large regression suites are red; rerun `bun run verify:m061:regression`.
- `status_code=m065_s03_nested_contract_failed`
  - the wrapped regression payload is malformed and cannot be trusted.
- `failing_check_id=M065-S03-RERUN-COMMAND-RESOLUTION`
  - the runbook/package wiring drifted; repair the command references before retrying milestone closure.
- `failing_check_id=M065-S03-RUNBOOK-PRESENCE`
  - the M065 rollout runbook is missing and must be restored.
- `failing_check_id=M065-S03-PACKAGE-WIRING`
  - the `verify:m065:s03` package script drifted and must point back to the tracked verifier.

## Operator workflow

1. Run `bun run verify:m065 -- --json`.
2. If `M065-FRESH-REGRESSION-PROOF` failed or is pending, run `bun run verify:m065:s03 -- --json`.
3. If S03 reports red regression suites, rerun `bun run verify:m061:regression` and inspect the failing `M061-REG-*` suite ids.
4. If S03 reports packaging drift, repair the runbook/package command references first, then rerun `bun run verify:m065:s03 -- --json`.
5. Rerun `bun run verify:m065 -- --json` to confirm the top-level blocker is cleared.

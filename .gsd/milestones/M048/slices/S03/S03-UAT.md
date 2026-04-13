# S03: Truthful Bounded Reviews and Synchronize Continuity — UAT

**Milestone:** M048
**Written:** 2026-04-13T04:32:47.944Z

# S03: Truthful Bounded Reviews and Synchronize Continuity — UAT

**Milestone:** M048

## Preconditions

- Deploy a revision that includes the S03 changes.
- Have access to the checked-in `.kodiai.yml`, GitHub Review Details, and the operator verifier CLI.
- For live proof, have permission to push a new commit to an `xbmc/kodiai` PR and capture the resulting `reviewOutputKey` from the published review.

## Test Case 1 — Local preflight proves checked-in synchronize intent and bounded-disclosure contract

1. Run `bun run verify:m048:s03 -- --json` from the repo root.
   - **Expected:** The command exits 0 and returns `status_code: "m048_s03_ok"`.
2. Inspect `local.synchronizeConfig` in the JSON output.
   - **Expected:** `configPresent: true`, `effectiveOnSynchronize: true`, `passed: true`, and `warnings` is empty for the checked-in config.
3. Inspect `local.boundedDisclosure.fixtures`.
   - **Expected:** `large-pr-strict` and `timeout-auto-reduced` require disclosure and pass; `small-unbounded` does not require disclosure and also passes.
4. Inspect `live` in the same output when no review key is provided.
   - **Expected:** `requested: false`, `skipped: true`, and no Azure/live evidence lookup is attempted.

## Test Case 2 — Live synchronize proof reuses the existing S01 evidence surface

1. Push a new commit to an `xbmc/kodiai` PR so GitHub emits a `pull_request.synchronize` event.
   - **Expected:** A new review run is triggered by the configured synchronize path.
2. Capture the published review's `reviewOutputKey`.
   - **Expected:** The key corresponds to the synchronize-triggered delivery.
3. Run `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`.
   - **Expected:** The command exits 0 with `status_code: "m048_s03_ok"`, `live.requested: true`, `live.skipped: false`, and `live.action: "synchronize"`.
4. Inspect `live.phaseTiming` in the JSON output.
   - **Expected:** The nested report is an S01-style phase report (`command: "verify:m048:s01"`) rather than a new parallel evidence schema, and it includes the correlated `review_output_key` plus six-phase timing evidence.

## Test Case 3 — Large or reduced strict reviews disclose requested versus effective scope exactly once

1. Trigger a strict review on a PR large enough to use large-PR triage, or a high-timeout-risk review that auto-reduces scope.
   - **Expected:** GitHub publishes one review result normally.
2. Open the published summary comment and inspect the `## What Changed` section.
   - **Expected:** Exactly one bounded-review disclosure sentence appears. For large strict triage, the sentence states the review remained strict but only covered a subset of changed files; for timeout auto-reduction, it states the review was reduced to the effective profile.
3. Expand Review Details for the same review.
   - **Expected:** Requested and effective review profile lines are visible, bounded-review/timeout status is explicit, and the disclosure wording matches the summary truthfully rather than implying exhaustive coverage.
4. Trigger a small unbounded review on a separate small PR.
   - **Expected:** No bounded-review disclosure sentence is added, and Review Details keeps the normal quiet single-profile path.

## Edge Case 1 — Legacy top-level synchronize intent fails loudly

1. In a temporary workspace, replace the checked-in nested trigger with only `review.onSynchronize: true`.
   - **Expected:** The config now expresses legacy intent using the unsupported shape.
2. Run `bun run verify:m048:s03 -- --json` in that temporary workspace.
   - **Expected:** The command exits non-zero with `status_code: "m048_s03_sync_config_drift"`, reports `effectiveOnSynchronize: false`, and includes an issue mentioning `review.onSynchronize`.

## Edge Case 2 — Non-synchronize review keys are rejected before live lookup

1. Obtain a valid `reviewOutputKey` from a non-synchronize event such as `review_requested`.
2. Run `bun run verify:m048:s03 -- --review-output-key "$NON_SYNCHRONIZE_KEY" --json`.
   - **Expected:** The command exits non-zero with `status_code: "m048_s03_live_key_mismatch"` and explains that the supplied key action is not `synchronize`.

## Edge Case 3 — Empty env-backed live input stays cheap and truthful

1. Run `REVIEW_OUTPUT_KEY='' bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`.
   - **Expected:** The command exits 0 with `status_code: "m048_s03_ok"`, `live.requested: false`, and `live.skipped: true` instead of misparsing the next CLI flag or attempting a live query.


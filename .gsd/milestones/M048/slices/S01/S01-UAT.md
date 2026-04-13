# S01: Live Phase Timing and Operator Evidence Surfaces — UAT

**Milestone:** M048
**Written:** 2026-04-13T00:24:30.407Z

# UAT — M048/S01 Live Phase Timing and Operator Evidence Surfaces

## Preconditions

- The current M048/S01 build is deployed to the live `kodiai` Azure Container App environment.
- You have Azure CLI access to the `rg-kodiai` Log Analytics workspaces.
- You have a real `xbmc/kodiai` pull request where `@kodiai review` can be requested.
- You can capture the emitted `reviewOutputKey` from the published review/review-details marker.

## Test Case 1 — Happy-path live review shows all six phases on GitHub and in Azure

1. Request a real review on an `xbmc/kodiai` PR.
   - **Expected:** the review runs normally and publishes Review Details without blocking on timing capture.
2. Open the Review Details comment/body that was published for that review.
   - **Expected:** it contains one timing block with these phases in this order: `queue wait`, `workspace preparation`, `retrieval/context assembly`, `executor handoff`, `remote runtime`, `publication`.
3. Confirm the timing block uses explicit degraded/unavailable wording when needed instead of missing lines or `0ms` placeholders.
   - **Expected:** every required phase is present, and any missing measurement is labeled unavailable/degraded with detail text.
4. Capture the `reviewOutputKey` for that review and run:
   - `bun run verify:m048:s01 -- --review-output-key "<live-review-output-key>" --json`
   - **Expected:** exit code 0, `status_code: "m048_s01_ok"`, a non-null evidence payload, the same six phases, and the same `reviewOutputKey` / `deliveryId` correlation used by Review Details.

## Test Case 2 — Correlation guard rejects contradictory delivery ids

1. Re-run the verifier for the same live review but append a wrong delivery id:
   - `bun run verify:m048:s01 -- --review-output-key "<live-review-output-key>" --delivery-id "wrong-delivery" --json`
   - **Expected:** exit code 1 with `status_code: "m048_s01_invalid_arg"` and an issue explaining that the provided `--delivery-id` does not match the delivery id encoded in the review key.
2. Confirm the command does not silently broaden the query.
   - **Expected:** no success report is emitted for unrelated Azure rows.

## Test Case 3 — Timeout/degraded reviews stay truthful

1. Use a real review that times out or otherwise publishes a partial/degraded outcome.
   - **Expected:** the review still publishes its truthful outcome instead of failing closed because timing capture is incomplete.
2. Inspect Review Details and rerun the verifier with that review's key.
   - **Expected:** affected phases show `degraded` or `unavailable` wording with detail text; the phase block still includes all six required phases; the verifier does not substitute invented durations.

## Test Case 4 — Automation with no injected live key skips cleanly instead of failing misleadingly

1. Leave `REVIEW_OUTPUT_KEY` unset and run:
   - `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`
   - **Expected:** exit code 0 with `status_code: "m048_s01_skipped_missing_review_output_key"` and an issue explaining that live Azure verification was skipped because no key was provided.
2. Confirm the command does not claim success for a real live review.
   - **Expected:** the report has no evidence payload and does not query broadly enough to invent a match.

## Edge Cases to Watch

- Review Details missing one of the six required phases.
- Azure rows present for the key but the verifier returns `m048_s01_invalid_phase_payload` because the phase payload is malformed.
- Azure rows exist for nearby reviews, but the verifier correctly returns `m048_s01_correlation_mismatch` for the requested `reviewOutputKey` / `deliveryId` pair.
- Publication timing is degraded/unavailable during partial/timeout paths, but the review outcome itself still publishes truthfully.

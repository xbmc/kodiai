# S02: Single-Worker Path Latency Reduction — UAT

**Milestone:** M048
**Written:** 2026-04-13T01:45:03.068Z

# S02 UAT — Single-Worker Path Latency Reduction

## Preconditions

- Deploy a revision that includes the S02 changes.
- Have one known-good S01 baseline `reviewOutputKey` from the same xbmc review path, within the last 14 days.
- Have permissions to trigger a fresh xbmc PR review and read GitHub Review Details plus Azure Log Analytics evidence.
- Export `BASELINE_REVIEW_OUTPUT_KEY` to the baseline key and `REVIEW_OUTPUT_KEY` to the fresh candidate key after the new review finishes.

## Test Case 1 — Fresh live compare shows the faster single-worker path without publication drift

1. Trigger a fresh review on the same xbmc review path used for the baseline.
   - **Expected:** GitHub publishes one normal review result and Review Details renders the six ordered phases from S01.
2. Capture the fresh candidate `reviewOutputKey` from the published review evidence.
   - **Expected:** You can identify one candidate key correlated to the new delivery.
3. Run `bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json`.
   - **Expected:** The command exits 0, returns `status_code: "m048_s02_ok"`, `comparison.outcome: "latency-improved"`, `comparison.targetedTotal.deltaMs < 0`, and `comparison.publicationContinuity.state` is `preserved` or `improved`.
4. Inspect the targeted phases in the JSON or human-readable report.
   - **Expected:** `workspace preparation`, `executor handoff`, and/or `remote runtime` show lower candidate durations than baseline, while queue/publication evidence remains visible rather than hidden.

## Test Case 2 — GitHub Review Details and Azure evidence still share the same truthful six-phase contract

1. Open the fresh candidate review comment in GitHub and expand Review Details.
   - **Expected:** The phases remain `queue wait`, `workspace preparation`, `retrieval/context assembly`, `executor handoff`, `remote runtime`, and `publication` in that order.
2. Cross-check the candidate review with `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`.
   - **Expected:** The S01 verifier returns the same six phases and the same correlation identifiers (`review_output_key`, `delivery_id`) used by the compare report.
3. Compare the S01 candidate report to the embedded `candidate` block inside the S02 compare report.
   - **Expected:** The candidate block is a verbatim S01-style report, not a separate evidence contract.

## Test Case 3 — Publication/idempotency continuity survives the faster path

1. Confirm the fresh candidate review published exactly once on GitHub.
   - **Expected:** One review publication exists for the candidate delivery; there is no duplicate publish caused by the faster transport/polling path.
2. Inspect `comparison.publicationContinuity` in the S02 compare report.
   - **Expected:** The state is not `regressed`; if publication changed, the report explains that change explicitly.
3. If you intentionally re-run the same delivery through the normal retry path, inspect the resulting GitHub surface.
   - **Expected:** Idempotency behavior matches pre-S02 behavior: no duplicate review output is published.

## Edge Case 1 — Missing env-backed review keys skip truthfully in automation

1. Run `BASELINE_REVIEW_OUTPUT_KEY='' REVIEW_OUTPUT_KEY='' bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json`.
   - **Expected:** The command exits 0 with `status_code: "m048_s02_skipped_missing_review_output_keys"` and does not attempt a broad Azure query.

## Edge Case 2 — Contradictory delivery overrides fail loudly

1. Run the compare command with a real baseline key plus a contradictory `--baseline-delivery-id` override.
   - **Expected:** The command exits non-zero with `status_code: "m048_s02_invalid_arg"` and explains that the override does not match the delivery id encoded in the review output key.


# Phase 75 Smoke: Live OPS Verification Closure

Run this smoke procedure once per release candidate to close OPS-04 and OPS-05 with
machine-checkable evidence.

## What This Closure Verifies

- Cache matrix coverage for the review_requested surface using fixed lane order
  `prime -> hit -> changed-query-miss`:
  - `OPS75-CACHE-01` review_requested cache lane
- Exactly-once degraded telemetry identity behavior:
  - `OPS75-ONCE-01` one degraded telemetry row per degraded identity
  - `OPS75-ONCE-02` duplicate detection query returns zero duplicate identities
- Fail-open completion when telemetry persistence is intentionally failed:
  - `OPS75-FAILOPEN-01` forced-failure identities persist zero telemetry rows
  - `OPS75-FAILOPEN-02` those identities still complete in `executions`

## Required Inputs

Collect live identities before running the command.

### Preflight (blocking)

Before collecting matrix identities, confirm each review lane run is accepted by
the review_requested gate:

- `requestedReviewer` is `kodiai` or `kodiai[bot]`, or
- requested team is approved rereview team (`ai-review` / `aireview`).

If logs show `skipReason=non-kodiai-reviewer` or `skipReason=team-only-request`,
the run is invalid for OPS75 closure and must be re-captured.

1) Cache matrix identities (3 total):
- Review lane: `<review-prime> <review-hit> <review-changed>`

1b) Accepted review lane identities (3 total, same order as review lane):
- `<accepted-review-prime> <accepted-review-hit> <accepted-review-changed>`
- These must be the review identities from accepted gate logs above.

2) Degraded identity list (`delivery_id:event_type`, one or more):
- Example: `degraded-review-1:pull_request.review_requested`
- Each identity must have exactly one `rate_limit_events` row where
  `LOWER(degradation_path) <> 'none'`.

3) Forced telemetry failure identity list (`delivery_id:event_type`, one or more):
- These runs must be executed with `TELEMETRY_RATE_LIMIT_FAILURE_IDENTITIES` enabled.
- Example: `failopen-review-1:pull_request.review_requested`

### Pre-verification checklist (blocking)

Before invoking `bun run verify:phase75`, run the OPS75 capture gate query in
`docs/runbooks/review-requested-debug.md` and confirm:

- review lane identities each have one `rate_limit_events` row with
  `pull_request.review_requested`
- degraded identities each have exactly one row where
  `LOWER(COALESCE(degradation_path, 'none')) <> 'none'`

If any precheck row is missing, reject that identity set and recapture before
running the verifier.

## Deterministic Run Sequence

For the `review_requested` surface, execute this fixed order:

1. Prime cache with baseline query
2. Repeat same query for cache hit
3. Change query text to force changed-query miss

Do not reorder lanes and do not substitute ad-hoc identities.

## Command

```sh
bun run verify:phase75 \
  --review <review-prime> \
  --review <review-hit> \
  --review <review-changed> \
  --review-accepted <accepted-review-prime> \
  --review-accepted <accepted-review-hit> \
  --review-accepted <accepted-review-changed> \
  --degraded <degraded-delivery:event-type> \
  --degraded <degraded-delivery:event-type> \
  --failopen <failopen-delivery:event-type>
```

Optional machine-readable evidence output:

```sh
bun run verify:phase75 \
  --review <review-prime> \
  --review <review-hit> \
  --review <review-changed> \
  --review-accepted <accepted-review-prime> \
  --review-accepted <accepted-review-hit> \
  --review-accepted <accepted-review-changed> \
  --degraded <degraded-delivery:event-type> \
  --failopen <failopen-delivery:event-type> \
  --json
```

## Expected Evidence Bundle

Capture and attach all of the following:

- Full command output (text or JSON)
- Final verdict line (`Final verdict: PASS [...]` or `Final verdict: FAIL [...]`)
- Matrix identity table printed by the command
- Accepted review_requested identity list printed by the command
- Explicit list of degraded identities and forced-failure identities used in the run

## Release-Blocking Interpretation

- **Pass:** all OPS75 check IDs pass and process exits `0`
- **Fail:** any OPS75 check ID fails and process exits non-zero

Any failure in `OPS75-CACHE-01`, `OPS75-ONCE-*`, or `OPS75-FAILOPEN-*` blocks
acceptance of OPS-04/OPS-05 closure evidence until remediated and rerun.

## Historical Run Data

Historical run data from plans 75-05 and 75-06 used the pre-75-07 verifier that
included additional cache lanes since removed. Those results are superseded. For the
current verifier invocation and trigger procedures, see
`docs/runbooks/review-requested-debug.md`.

# Phase 75 Smoke: Live OPS Verification Closure

Run this smoke procedure once per release candidate to close OPS-04 and OPS-05 with
machine-checkable evidence.

## What This Closure Verifies

- Cache matrix coverage for both trigger surfaces using fixed lane order
  `prime -> hit -> changed-query-miss`:
  - `OPS75-CACHE-01` review_requested cache lane
  - `OPS75-CACHE-02` explicit `@kodiai` mention cache lane
- Exactly-once degraded telemetry identity behavior:
  - `OPS75-ONCE-01` one degraded telemetry row per degraded identity
  - `OPS75-ONCE-02` duplicate detection query returns zero duplicate identities
- Fail-open completion when telemetry persistence is intentionally failed:
  - `OPS75-FAILOPEN-01` forced-failure identities persist zero telemetry rows
  - `OPS75-FAILOPEN-02` those identities still complete in `executions`

## Required Inputs

Collect live identities before running the command.

1) Cache matrix identities (6 total):
- Review lane: `<review-prime> <review-hit> <review-changed>`
- Mention lane: `<mention-prime> <mention-hit> <mention-changed>`

2) Degraded identity list (`delivery_id:event_type`, one or more):
- Example: `degraded-review-1:pull_request.review_requested`
- Example: `degraded-mention-1:issue_comment.created`

3) Forced telemetry failure identity list (`delivery_id:event_type`, one or more):
- These runs must be executed with `TELEMETRY_RATE_LIMIT_FAILURE_IDENTITIES` enabled.
- Example: `failopen-review-1:pull_request.review_requested`

## Deterministic Run Sequence

For each surface (`review_requested`, explicit mention), execute this fixed order:

1. Prime cache with baseline query
2. Repeat same query for cache hit
3. Change query text to force changed-query miss

Do not reorder lanes and do not substitute ad-hoc identities.

## Command

```sh
bun run verify:phase75 \
  --review <review-prime> <review-hit> <review-changed> \
  --mention <mention-prime> <mention-hit> <mention-changed> \
  --degraded <degraded-delivery:event-type> \
  --degraded <degraded-delivery:event-type> \
  --failopen <failopen-delivery:event-type>
```

Optional machine-readable evidence output:

```sh
bun run verify:phase75 \
  --review <review-prime> <review-hit> <review-changed> \
  --mention <mention-prime> <mention-hit> <mention-changed> \
  --degraded <degraded-delivery:event-type> \
  --failopen <failopen-delivery:event-type> \
  --json
```

## Expected Evidence Bundle

Capture and attach all of the following:

- Full command output (text or JSON)
- Final verdict line (`Final verdict: PASS [...]` or `Final verdict: FAIL [...]`)
- Matrix identity table printed by the command
- Explicit list of degraded identities and forced-failure identities used in the run

## Release-Blocking Interpretation

- **Pass:** all OPS75 check IDs pass and process exits `0`
- **Fail:** any OPS75 check ID fails and process exits non-zero

Any failure in `OPS75-CACHE-*`, `OPS75-ONCE-*`, or `OPS75-FAILOPEN-*` blocks
acceptance of OPS-04/OPS-05 closure evidence until remediated and rerun.

For triage SQL and troubleshooting mapped to each check family, use
`docs/runbooks/review-requested-debug.md`.

# review_requested Debug Runbook

Use this runbook when manual re-requesting kodiai on a PR does not trigger a review.

## UI-based Re-review (Team Request)

If you want a UI-only retrigger (no comment), request review from the team `ai-review` (or `aireview`).
Kodiai treats `pull_request.review_requested` for that team as a re-review trigger.

## 1) Confirm webhook delivery exists in GitHub

Look for `pull_request` with action `review_requested` in GitHub App deliveries.

```sh
gh api repos/<owner>/<repo>/hooks --jq '.[].id'
gh api repos/<owner>/<repo>/hooks/<hook-id>/deliveries --jq '.[] | {id,event,action,status_code,delivered_at}'
```

Expected signal:
- A delivery exists with `event: "pull_request"` and `action: "review_requested"`.
- Delivery headers include `X-GitHub-Delivery` (this is the correlation key).

## 2) Correlate ingress and router logs by delivery ID

Search application logs for the exact `X-GitHub-Delivery` value.

```sh
# Example Azure Log Analytics query
AppTraces
| where Message has "deliveryId"
| where Message has "<delivery-id>"
| project TimeGenerated, Message
| order by TimeGenerated asc
```

Expected log chain includes:
- `Webhook accepted and queued for dispatch`
- `Router evaluated dispatch keys`
- Either `Dispatched to ... handler(s)` or explicit filtered/no-handler skip reason

## Evidence Bundle (Review)

When review output is published or an approval is submitted, the handler emits a single structured log line:

- Message: `Evidence bundle`
- Fields:
  - `evidenceType=review`
  - `outcome=published-output|submitted-approval`
  - `deliveryId`
  - `installationId`
  - `repo`
  - `prNumber`
  - `reviewOutputKey`

## 3) Verify review_requested gate decision

For the same `deliveryId`, check review handler gate logs.

Expected outcomes:
- Accepted path: `Accepted review_requested event for kodiai reviewer`
- Accepted path (team-based rereview): `Accepted review_requested event for rereview team` (team `ai-review`)
- Skip path with reason:
  - `non-kodiai-reviewer`
  - `team-only-request`
  - `missing-or-malformed-reviewer-payload`
  - `trigger-disabled`
  - `review-disabled`

If skip reason is `non-kodiai-reviewer`, confirm the re-request target is the app reviewer (`kodiai` or `kodiai[bot]`).

If using team-based UI retrigger, confirm the requested team is `ai-review` or `aireview`.

## 4) Verify queue lifecycle for same delivery

Look for queue logs with the same `deliveryId`:
- `Review enqueue started`
- `Job execution started`
- `Job execution completed` (or `Job execution failed`)
- `Review enqueue completed`

If `Review enqueue started` exists but no `Job execution started`, investigate queue saturation or process crash.

## 5) Local replay check (fast isolation)

Replay a captured payload to confirm webhook -> router -> handler flow.

```sh
curl -i -X POST http://localhost:3000/webhooks/github \
  -H "X-GitHub-Event: pull_request" \
  -H "X-GitHub-Delivery: replay-review-requested-001" \
  -H "X-Hub-Signature-256: sha256=<valid-signature>" \
  -H "Content-Type: application/json" \
  --data-binary @tmp/review-requested.json
```

Expected:
- HTTP `200` with `{ "received": true }`
- Correlated logs show full path and a single review enqueue/execution

## Triage Matrix

- No GitHub delivery: webhook misconfiguration or GitHub-side failure.
- Delivery exists, no ingress log: wrong endpoint, signature failure, or service unavailable.
- Ingress present, router filtered/no handler: sender filter or event key mismatch.
- Router dispatched, handler skipped: reviewer target/team-only/config gate.
- Enqueued but execution failed: workspace/git/executor failure; inspect `Job execution failed` error payload.

## Smoke Procedure: Manual Re-request Must Trigger Exactly One Run

1. Remove kodiai as reviewer from a test PR.
2. Re-request reviewer manually for kodiai.
3. Confirm exactly one `pull_request.review_requested` delivery in GitHub.
4. Confirm one contiguous `deliveryId` log chain ending in one `Job execution completed`.
5. Confirm exactly one review output/comment set was produced for the PR.

## Phase 72 Telemetry Evidence Queries

Use these snippets while running `docs/smoke/phase72-telemetry-follow-through.md`.

### 1) Duplicate emission check (`delivery_id + event_type`)

```sql
SELECT
  delivery_id,
  event_type,
  COUNT(*) AS cnt
FROM rate_limit_events
WHERE delivery_id IN ('<review-prime>', '<review-hit>', '<review-changed>')
GROUP BY delivery_id, event_type
HAVING COUNT(*) > 1;
```

Expected: zero rows.

### 2) Cache-hit sequence check (prime -> hit -> changed-query miss)

```sql
SELECT
  delivery_id,
  event_type,
  cache_hit_rate,
  skipped_queries,
  retry_attempts,
  degradation_path,
  created_at
FROM rate_limit_events
WHERE delivery_id IN ('<review-prime>', '<review-hit>', '<review-changed>')
ORDER BY created_at ASC;
```

Expected cache sequence for locked review run: `0`, `1`, `0`.

### 3) Non-blocking completion check when telemetry is degraded/failing

```sql
SELECT
  delivery_id,
  event_type,
  conclusion,
  created_at
FROM executions
WHERE delivery_id IN (
  '<review-prime>',
  '<review-hit>',
  '<review-changed>'
)
ORDER BY created_at ASC;
```

Expected: rows exist for all three review deliveries with non-failing conclusions.

If conclusions are present but telemetry rows are missing, treat it as a telemetry persistence path issue and confirm the user-facing review still completed before remediation.

## Phase 75 OPS Closure: Operator Trigger Procedures

Use these procedures to produce the production evidence needed for OPS75 closure.
Cache checks are scoped to the review handler only -- the mention handler does not
use Search API cache and never emits `rate_limit_events` rows.

### Cache-Hit Trigger Procedure

To produce the three review-lane cache identities (prime, hit, changed-query-miss):

1. **Prime run (cache_hit_rate=0):** Request a kodiai review on a test PR. Record the
   `X-GitHub-Delivery` header from the webhook delivery. This is `<review-prime>`.

2. **Cache-hit run (cache_hit_rate=1):** Re-request kodiai review on the **same PR**
   for the **same author** within the Search cache TTL window (default 5 minutes).
   The second delivery produces `searchCacheHit=true`. Record the delivery ID as
   `<review-hit>`.

3. **Changed-query-miss run (cache_hit_rate=0):** Request kodiai review on a
   **different PR** by a **different author** so the Search query differs and misses
   the cache. Record the delivery ID as `<review-changed>`.

4. Verify all three identities have `rate_limit_events` rows before proceeding:

```sql
SELECT delivery_id, event_type, cache_hit_rate
FROM rate_limit_events
WHERE delivery_id IN ('<review-prime>', '<review-hit>', '<review-changed>')
ORDER BY created_at ASC;
```

Expected sequence: `0 -> 1 -> 0`.

### Degraded Run Trigger Procedure

1. Use the degraded-review trigger script to exhaust the 30/min Search API rate limit:

```sh
bun run scripts/phase73-trigger-degraded-review.ts
```

2. While rate-limited, request a kodiai review. The review runs under degradation
   (`degradation_path != "none"`). Record the `X-GitHub-Delivery` as the degraded
   identity.

3. Verify the row exists before feeding it to the verifier:

```sql
SELECT delivery_id, event_type, degradation_path
FROM rate_limit_events
WHERE delivery_id = '<degraded-delivery>'
  AND LOWER(COALESCE(degradation_path, 'none')) <> 'none';
```

Expected: exactly one row with a non-`none` degradation path.

### Updated Verifier Command (no --mention flags)

```sh
bun run scripts/phase75-live-ops-verification-closure.ts \
  --review <review-prime> --review <review-hit> --review <review-changed> \
  --review-accepted <review-prime> --review-accepted <review-hit> --review-accepted <review-changed> \
  --degraded <delivery-id>:<event-type> \
  --failopen <delivery-id>:<event-type>
```

## Phase 75 OPS Closure SQL Checks

Use these snippets when running `docs/smoke/phase75-live-ops-verification-closure.md`.

### OPS75 capture gate: hard same-run identity preflight before verifier run

Run this gate first with the exact identities you plan to pass to
`bun run verify:phase75`. This is a hard release gate.

Required identity sets:
- Review lane (`--review`): `<review-prime>`, `<review-hit>`, `<review-changed>`
- Accepted review lane (`--review-accepted`): same identities as review lane, from
  accepted `review_requested` logs
- Degraded (`--degraded`): one or more `<delivery-id>:<event-type>` identities

#### Gate query A: lane row presence + same-run window

```sql
WITH lane_inputs(lane, expected_event_type, delivery_id) AS (
  VALUES
    ('review_prime', 'pull_request.review_requested', '<review-prime>'),
    ('review_hit', 'pull_request.review_requested', '<review-hit>'),
    ('review_changed', 'pull_request.review_requested', '<review-changed>')
)
SELECT
  li.lane,
  li.delivery_id,
  li.expected_event_type,
  COUNT(rle.delivery_id) AS row_count,
  MIN(rle.created_at) AS first_seen_at,
  MAX(rle.created_at) AS last_seen_at,
  CASE
    WHEN COUNT(rle.delivery_id) = 0 THEN 'BLOCKED: missing telemetry row'
    WHEN COUNT(rle.delivery_id) > 1 THEN 'BLOCKED: duplicate telemetry rows'
    WHEN MIN(rle.event_type) <> li.expected_event_type THEN 'BLOCKED: wrong event_type'
    ELSE 'PASS'
  END AS gate_result
FROM lane_inputs li
LEFT JOIN rate_limit_events rle ON rle.delivery_id = li.delivery_id
GROUP BY li.lane, li.delivery_id, li.expected_event_type
ORDER BY li.lane;
```

Pass condition:
- Every lane row returns `row_count = 1` and `gate_result = PASS`.

Block conditions:
- Any lane with `row_count = 0` blocks `OPS75-CACHE-01`.
- Any lane with `row_count > 1` blocks `OPS75-ONCE-02` (duplicate identity risk).

#### Gate query B: degraded exactly-once candidate check

```sql
SELECT
  delivery_id,
  event_type,
  COUNT(*) AS degraded_rows,
  MIN(created_at) AS first_seen_at,
  MAX(created_at) AS last_seen_at,
  CASE
    WHEN COUNT(*) = 1 THEN 'PASS'
    WHEN COUNT(*) = 0 THEN 'BLOCKED: missing degraded telemetry row'
    ELSE 'BLOCKED: duplicate degraded telemetry rows'
  END AS gate_result
FROM rate_limit_events
WHERE delivery_id IN ('<degraded-id-1>')
  AND LOWER(COALESCE(degradation_path, 'none')) <> 'none'
GROUP BY delivery_id, event_type
ORDER BY delivery_id, event_type;
```

Pass condition:
- Every degraded identity chosen for `--degraded` has exactly one row where
  `LOWER(COALESCE(degradation_path, 'none')) <> 'none'`.

Block conditions:
- Missing row blocks `OPS75-ONCE-01`.
- Duplicate rows block `OPS75-ONCE-02`.

#### Gate query C: explicit blocker summary by check ID

```sql
WITH lane_inputs(check_id, lane, expected_event_type, delivery_id) AS (
  VALUES
    ('OPS75-CACHE-01', 'review_prime', 'pull_request.review_requested', '<review-prime>'),
    ('OPS75-CACHE-01', 'review_hit', 'pull_request.review_requested', '<review-hit>'),
    ('OPS75-CACHE-01', 'review_changed', 'pull_request.review_requested', '<review-changed>')
)
SELECT
  li.check_id,
  li.lane,
  li.delivery_id,
  CASE
    WHEN COUNT(rle.delivery_id) = 1 AND MIN(rle.event_type) = li.expected_event_type THEN 'PASS'
    WHEN COUNT(rle.delivery_id) = 0 THEN 'BLOCKED: no telemetry row'
    WHEN COUNT(rle.delivery_id) > 1 THEN 'BLOCKED: duplicate telemetry rows'
    ELSE 'BLOCKED: event_type mismatch'
  END AS status
FROM lane_inputs li
LEFT JOIN rate_limit_events rle ON rle.delivery_id = li.delivery_id
GROUP BY li.check_id, li.lane, li.delivery_id, li.expected_event_type
ORDER BY li.check_id, li.lane;
```

Release rule (carry-forward):
- Any non-`PASS` result above is a release blocker.
- Do not run or claim closure from `verify:phase75` with blocked identities.
- If a rerun was executed and any OPS75 check failed, document the exact failing
  check IDs and keep status blocked.

### OPS75-PREFLIGHT-01: Accepted review_requested gate evidence

From application logs for the same matrix capture window, confirm:

- `gate=review_requested_reviewer`
- `gateResult=accepted`
- `requestedReviewer` is `kodiai` / `kodiai[bot]` OR accepted rereview team

Any `skipReason=non-kodiai-reviewer` or `skipReason=team-only-request` means
that identity is invalid for closure evidence.

### OPS75-CACHE-01: Cache matrix sequence (review_requested only)

```sql
SELECT
  delivery_id,
  event_type,
  cache_hit_rate,
  degradation_path,
  created_at
FROM rate_limit_events
WHERE delivery_id IN (
  '<review-prime>',
  '<review-hit>',
  '<review-changed>'
)
ORDER BY created_at ASC;
```

Expected:
- Review lane (`pull_request.review_requested`): cache sequence `0 -> 1 -> 0`

### OPS75-ONCE-01 / OPS75-ONCE-02: Exactly-once degraded telemetry identity

```sql
SELECT
  delivery_id,
  event_type,
  COUNT(*) AS cnt
FROM rate_limit_events
WHERE delivery_id IN ('<degraded-id-1>')
  AND LOWER(COALESCE(degradation_path, 'none')) <> 'none'
GROUP BY delivery_id, event_type
ORDER BY delivery_id, event_type;
```

Expected:
- Every degraded identity appears exactly once (`cnt = 1`)
- No duplicate rows where `cnt > 1`

### OPS75-FAILOPEN-01: Forced telemetry failure identities wrote zero telemetry rows

```sql
SELECT
  delivery_id,
  event_type,
  COUNT(*) AS cnt
FROM rate_limit_events
WHERE delivery_id IN ('<failopen-id-1>', '<failopen-id-2>')
GROUP BY delivery_id, event_type;
```

Expected: zero rows for forced-failure identities.

### OPS75-FAILOPEN-02: Forced telemetry failure identities still completed

```sql
SELECT
  delivery_id,
  event_type,
  conclusion,
  created_at
FROM executions
WHERE delivery_id IN ('<failopen-id-1>', '<failopen-id-2>')
ORDER BY created_at ASC;
```

Expected:
- Rows exist for all forced-failure identities
- Conclusions are non-failing (`success`, `completed`, etc.)

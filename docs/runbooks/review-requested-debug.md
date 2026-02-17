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
  '<review-changed>',
  '<mention-prime>',
  '<mention-hit>',
  '<mention-changed>'
)
ORDER BY created_at ASC;
```

Expected: rows exist for all six deliveries with non-failing conclusions.

If conclusions are present but telemetry rows are missing, treat it as a telemetry persistence path issue and confirm the user-facing review/mention still completed before remediation.

## Phase 75 OPS Closure SQL Checks

Use these snippets when running `docs/smoke/phase75-live-ops-verification-closure.md`.

### OPS75-PREFLIGHT-01: Accepted review_requested gate evidence

From application logs for each review lane identity, confirm:

- `gate=review_requested_reviewer`
- `gateResult=accepted`
- `requestedReviewer` is `kodiai` / `kodiai[bot]` OR accepted rereview team

Any `skipReason=non-kodiai-reviewer` or `skipReason=team-only-request` means
that identity is invalid for closure evidence.

### OPS75-CACHE-01 / OPS75-CACHE-02: Cache matrix sequence per surface

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
  '<review-changed>',
  '<mention-prime>',
  '<mention-hit>',
  '<mention-changed>'
)
ORDER BY created_at ASC;
```

Expected:
- Review lane (`pull_request.review_requested`): cache sequence `0 -> 1 -> 0`
- Mention lane (`issue_comment.created`): cache sequence `0 -> 1 -> 0`

### OPS75-ONCE-01 / OPS75-ONCE-02: Exactly-once degraded telemetry identity

```sql
SELECT
  delivery_id,
  event_type,
  COUNT(*) AS cnt
FROM rate_limit_events
WHERE delivery_id IN ('<degraded-id-1>', '<degraded-id-2>', '<degraded-id-3>')
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

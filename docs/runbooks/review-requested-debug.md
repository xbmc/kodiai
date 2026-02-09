# review_requested Debug Runbook

Use this runbook when manual re-requesting kodiai on a PR does not trigger a review.

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

## 3) Verify review_requested gate decision

For the same `deliveryId`, check review handler gate logs.

Expected outcomes:
- Accepted path: `Accepted review_requested event for kodiai reviewer`
- Skip path with reason:
  - `non-kodiai-reviewer`
  - `team-only-request`
  - `missing-or-malformed-reviewer-payload`
  - `trigger-disabled`
  - `review-disabled`

If skip reason is `non-kodiai-reviewer`, confirm the re-request target is the app reviewer (`kodiai` or `kodiai[bot]`).

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

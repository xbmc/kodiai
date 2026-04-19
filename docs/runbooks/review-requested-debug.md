# review_requested Debug Runbook

Use this runbook when Kodiai review triggering needs investigation. The only supported manual re-review procedure is an explicit PR-scoped `@kodiai review` mention. Keep `pull_request.review_requested` in scope here as a debug and automatic-review surface, not as an operator retrigger procedure.

## Supported manual re-review procedure

If you need to manually retrigger a review, post `@kodiai review` on the PR. Supported mention surfaces are:

- `issue_comment` with action `created` on the PR top-level thread
- `pull_request_review_comment` with action `created` on an inline diff thread
- `pull_request_review` with action `submitted` when the review body itself contains the trigger

Do not use team reviewer requests as a manual re-review mechanism. Team-only `pull_request.review_requested` deliveries should be treated as unsupported debug signals and will skip with `team-only-request`.

## 1) Confirm the correct GitHub delivery exists

For manual re-review, verify one of the PR-scoped mention deliveries above exists. If you are debugging the automatic reviewer-request surface instead, the relevant delivery is `pull_request` with action `review_requested`.

```sh
gh api repos/<owner>/<repo>/hooks --jq '.[].id'
gh api repos/<owner>/<repo>/hooks/<hook-id>/deliveries --jq '.[] | {id,event,action,status_code,delivered_at}'
```

Expected signal:
- A delivery exists for the trigger lane you used.
- Delivery headers include `X-GitHub-Delivery` (this is the correlation key).

## 2) Correlate ingress and router logs by delivery ID

Search application console logs for the exact `X-GitHub-Delivery` value.

```sh
# Azure Log Analytics query: delivery correlation
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s has "<delivery-id>"
| project TimeGenerated, Log_s
| order by TimeGenerated asc
```

If you need to prove the request stayed on the full-review execution path, use the delivery-linked queue/handler logs first, then use the adjacent router query to confirm there was a nearby `taskType=review.full` executor start in the same time window:

```sh
# Azure Log Analytics query: router resolution for taskType=review.full
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s has "Task router resolved model"
| where Log_s has "\"taskType\":\"review.full\""
| project TimeGenerated, Log_s
| order by TimeGenerated asc
```

Expected early log chain includes:
- `Webhook accepted and queued for dispatch`
- `Router evaluated dispatch keys`
- Either `Dispatched to ... handler(s)` or an explicit filtered/no-handler skip reason

If the handler actually proceeds into review execution, a later nearby log should show:
- `Task router resolved model` with `taskType=review.full`

Note: `taskType=review.full` proves the execution path, not the queue lane, and it is not directly keyed by `deliveryId`. Use the delivery-linked queue logs to establish the time window first, then confirm the executor-start log in that same window. To distinguish `lane=review` from `lane=interactive-review`, use the queue logs described below.

## Lane-State and Stale-Job Triage

The queue is installation-scoped and lane-aware. For review debugging, always compare the
queue logs before assuming the trigger never reached a worker.

Current operator-visible lanes:

- `review` — automatic PR review jobs, including `pull_request.review_requested`
- `interactive-review` — explicit PR-scoped mention requests via `@kodiai review`
- `sync` — non-review mention work plus follow-up jobs such as `feedback-sync`, `review-comment-sync`, and other auxiliary work

For the same installation and PR-family key (`owner/repo#pr`), compare these signals in order:

1. `Enqueuing job for installation`
   - Confirms the job entered the queue.
   - Check `lane`, `key`, `jobType`, `phase`, `laneQueueSize`, and `lanePendingCount`.
2. `Job execution started`
   - Confirms that lane actually acquired a worker.
   - If enqueue exists but this log never appears for the same `jobId` / `lane` / `key`, the job is still waiting behind another job on that installation lane.
3. Latest visible `phase`
   - Queue logs provide the coarse job lifecycle state:
     - `phase=queued` on `Enqueuing job for installation`
     - `phase=running` on `Job execution started`
   - For an explicit `@kodiai review` that is escaping an older automatic review, use `predecessorPhase` from `Explicit review claim found a stale predecessor attempt` to see the last known review-family checkpoint of that older run.
   - For completed automatic-review runs on the `review` lane, use `Review phase timing summary` to inspect the higher-level timing phases emitted by the review handler (`queue wait`, `workspace preparation`, `retrieval/context assembly`, `executor handoff`, `remote runtime`, `publication`).
   - For completed explicit `@kodiai review` runs on the `interactive-review` lane, use `Mention execution completed` together with the publish-resolution / idempotency logs instead; the mention handler does not emit `Review phase timing summary`.
4. Whether another same-installation job is holding the `review` lane
   - Automatic review_requested runs serialize on `lane=review`.
   - If a new automatic review is queued but not started, search the same installation for an older active `lane=review` job with the same or different PR key.
   - Explicit `@kodiai review` runs should use `lane=interactive-review`; if they are blocked, verify they were not misrouted onto `lane=review` or `lane=sync`.

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

## M050 Timeout-Truth Verifier Surfaces

Use the M048 verifier family directly when you need a machine-checkable answer for the repaired small-PR timeout class.

### Local deterministic timeout-truth proof

```sh
bun run verify:m048:s03 -- --json
```

Interpret these fields:
- `local.timeoutSurfaces.passed=true` means the timeout partial-review line and timeout `Review Details` block still agree on:
  - analyzed files vs total changed files
  - captured finding count
  - retry state (`scheduled ...` vs `skipped ...`)
- Fixture names:
  - `timeout-scheduled-retry` — timeout output stayed truthful when a reduced-scope retry is still eligible
  - `timeout-retry-skipped` — timeout output stayed truthful when chronic-timeout suppression skips the retry

### Live single-run proof for one review output key

```sh
bun run verify:m048:s01 -- --review-output-key <review-output-key> --json
```

Interpret these fields:
- `outcome.class=success|timeout_partial|timeout|failure|unknown`
- `outcome.summary` explains whether visible partial output was published
- `evidence.phases` still shows where latency landed (`executor handoff`, `remote runtime`, `publication`)

### Baseline vs candidate timeout-class compare

```sh
bun run verify:m048:s02 -- \
  --baseline-review-output-key <baseline-key> \
  --candidate-review-output-key <candidate-key> \
  --json
```

Interpret these fields:
- `comparison.timeoutClass.state=retired` is the desired repaired outcome
- `comparison.timeoutClass.state=persisted` means the candidate still landed in the old timeout class
- `comparison.timeoutClass.state=introduced` means the candidate regressed into the timeout class
- `status_code=m048_s02_timeout_class_persisted|m048_s02_timeout_class_regressed` is an operator-visible failure even if targeted latency deltas look better

## 3) Verify the explicit `@kodiai review` publish bridge

On a PR comment, `@kodiai review` is handled by the mention handler as an explicit review request. The executor still runs on `taskType=review.full`, but the mention handler owns the GitHub approval publish bridge and the publish-resolution logs.

If the explicit review looks like it is escaping a stale automatic review, also search for the stale-predecessor telemetry line:

- `Explicit review claim found a stale predecessor attempt`

Key fields on that log line:

- `predecessorAttemptId`
- `predecessorPhase`
- `predecessorAgeMs`

Use them like this:

- `predecessorAttemptId` identifies the older same-PR review-family attempt.
- `predecessorPhase` tells you the last review-family phase that predecessor reached.
- `predecessorAgeMs` tells you how long that predecessor had been idle when the explicit interactive-review claim succeeded.

That log proves the same-PR review-family claim happened. It does **not** prove the interactive-review lane actually started running yet — use `Enqueuing job for installation` and `Job execution started` for queue acceptance.

Compare those fields with the queue lane-state signals above. If the predecessor was on the same installation and another `lane=review` job is still active, that older automatic run is the likely reason the manual re-review appeared stale.

Start with the delivery-linked logs to discover the `reviewOutputKey`, then pivot to that key (and the same time window) for the mention publish-resolution / completion logs:

```sh
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s has "<delivery-id>" or Log_s has "<review-output-key>"
| project TimeGenerated, Log_s
| order by TimeGenerated asc
```

Expected success and recovery outcomes:

- **Executor already published visible review output**
  - `Mention execution completed` with:
    - `explicitReviewRequest=true`
    - `publishResolution=executor`
    - `reviewOutputKey=<key>`
- **Fresh approval publish**
  - `Explicit mention review idempotency check passed`
  - `Submitted approval review for explicit mention request`
  - `Mention execution completed` with:
    - `explicitReviewRequest=true`
    - `publishResolution=approval-bridge`
    - `reviewOutputKey=<key>`
- **Already published / idempotent skip**
  - `Skipping explicit mention review publish because output already exists`
  - `reviewOutputPublicationState=skip-existing-output`
  - `Mention execution completed` with `publishResolution=idempotency-skip`
- **Approval API errored, but output already landed**
  - `Explicit mention review publish error still produced output; suppressing fallback`
  - `reviewOutputPublicationState=skip-existing-output`
  - `Mention execution completed` with `publishResolution=duplicate-suppressed`

Failure-path outcomes are also explicit:

- `publishResolution=publish-failure-fallback` means the approval publish failed and Kodiai posted an error comment instead.
- `publishResolution=publish-failure-comment-failed` means the approval publish failed and even the fallback error comment could not be delivered.

`reviewOutputKey` is the durable correlation key across the idempotency logs, the evidence bundle, and the final completion log.

## 4) Verify review_requested gate decision

For the same `deliveryId`, check review handler gate logs.

Expected outcomes:
- Accepted path: `Accepted review_requested event for kodiai reviewer`
- Skip path with reason:
  - non-Kodiai reviewer target
  - `team-only-request`
  - `missing-or-malformed-reviewer-payload`
  - `trigger-disabled`
  - `review-disabled`

If the skip reason indicates a non-Kodiai reviewer target, confirm the re-request target is the app reviewer (`kodiai` or `kodiai[bot]`).

If skip reason is `team-only-request`, the delivery targeted an unsupported reviewer-team path and cannot be used as manual re-review evidence.

## 5) Verify queue lifecycle

### Automatic review_requested lane (`lane=review`)

Look for queue logs with the same `deliveryId`:
- `Review enqueue started`
- `Job execution started`
- `Job execution completed` (or `Job execution failed`)
- `Review enqueue completed`

### Explicit `@kodiai review` lane (`lane=interactive-review`)

Use the mention-handler queue logs instead:
- `Enqueuing job for installation`
- `Job execution started`
- `Mention execution completed` (or explicit publish-failure / fallback logs)

`ACA Job start request prepared` is still a useful adjacent signal, but it does not carry `deliveryId` today. Correlate it by time window plus `workspaceDir` (derived from the delivery identity) rather than expecting an exact delivery-ID match.

If `ACA Job start request rejected` appears, inspect the structured fields on that log line:
- `specImage`
- `bodyContainerNames`
- `bodyImages`
- `bodyEnvNames`
- `responseBody`

These fields are the authoritative evidence for Azure Job start contract mismatches.

If `Review enqueue started` exists but no `Job execution started`, investigate queue saturation, process crash, or an ACA start rejection.

## 6) Local replay check (fast isolation)

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
- `requestedReviewer` is `kodiai` / `kodiai[bot]`

Any non-Kodiai reviewer target skip or `skipReason=team-only-request` means
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

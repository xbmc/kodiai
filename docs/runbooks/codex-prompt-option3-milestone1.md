# Codex prompt — Option 3, Milestone 1 (receiver/worker split, no scale-to-zero yet)

Copy everything below the line into Codex.

---

You're working in the `kodiai` repo (Bun + Hono TypeScript app on Azure
Container Apps). Full context and rationale for this change is in
`docs/runbooks/azure-cost-architecture-review.md` — read that first,
especially §1 (current architecture), §5 (idempotency/retry/DLQ), §7-8 (MCP
callback registry constraints), and §9-10 (rollout plan and why this
milestone is scoped the way it is). Don't re-derive the cost analysis; it's
already done. Your job is the implementation.

## Goal

Split the current single `ca-kodiai` app into two Azure Container Apps
talking over an Azure Storage Queue:

1. **Receiver** (new, tiny): owns `/github`, `/events` (Slack), and the
   Slack relay webhook routes. Does signature verification, delivery-ID
   dedup, and rate limiting exactly as today — but instead of dispatching
   the event in-process, it enqueues a message and returns 200/ack
   immediately.
2. **Worker** (the rest of today's app): dequeues messages and runs the
   existing event router / review orchestration / ACA job dispatch / MCP
   callback server exactly as it does today, unchanged in behavior.

## Explicit scope boundaries — do not do these in this milestone

- **Do NOT implement scale-to-zero.** The worker must be deployed with
  `minReplicas=1, maxReplicas=1`, identical to today's scaling posture. This
  milestone is only about proving the queue plumbing works; scale-to-zero is
  a separate follow-up once this is stable in production (see runbook §9,
  rollout step 1 vs step 2).
- **Do NOT touch the MCP callback token registry**
  (`src/execution/mcp/http-server.ts`). It stays exactly as-is, in-memory,
  on the worker. This is safe because the worker stays single-replica.
- **Do NOT introduce Service Bus.** Use Azure Storage Queue — the existing
  `kodiaistg` storage account already used for Azure Files. See runbook §6
  for why.
- **Do NOT change review-idempotency logic.** The existing GitHub-truth-based
  publish checks (`review-orchestration/review-idempotency.ts`,
  `ensureReviewOutputNotPublished`) already make the worker safe against a
  queue redelivering a message — reuse them, don't add a parallel mechanism.

## What to build

### 1. Queue client

- Add `@azure/storage-queue` as a dependency.
- New module, e.g. `src/queue/webhook-queue.ts`, exposing `enqueue(event)`
  and a `dequeue`/`receiveMessages` + `deleteMessage` wrapper. Use managed
  identity for auth (same pattern as the rest of the repo's Azure access —
  check `src/jobs/aca-launcher.ts` for how managed identity tokens are
  fetched via `IDENTITY_ENDPOINT`/`IDENTITY_HEADER`, or use
  `@azure/identity`'s `DefaultAzureCredential` if that's cleaner with the
  storage SDK — your call, but stay consistent with how the rest of the repo
  authenticates to Azure).
- Message payload: whatever `WebhookEvent` needs to be reconstructed
  worker-side (source, delivery ID, event name, headers, body) — this is
  almost exactly the shape already durably stored in the `webhook_queue`
  Postgres table (`src/db/migrations/004-webhook-queue.sql`). Reuse that
  shape/serialization rather than inventing a new one.
- Visibility timeout: set comfortably above the max review wall-time —
  match the existing `ACA_JOB_REPLICA_TIMEOUT` margin (1860s in
  `deploy.sh`), so a crashed worker's message becomes redeliverable
  automatically without a custom retry scheduler.
- Dead-letter: implement the standard poison-message pattern using the
  queue message's `dequeueCount` — after N attempts (start with 5), move the
  message to a second queue (e.g. `webhook-queue-poison`) and log/alert.
  Storage Queue has no native DLQ; this is the app-level equivalent.

### 2. Receiver app

- New entry point (or a build target driven by an env flag on the existing
  entry point — pick whichever is less invasive given how `src/index.ts` is
  currently wired) that mounts only:
  - `createWebhookRoutes` (GitHub) — `src/routes/webhooks.ts`
  - `createSlackEventRoutes` — `src/routes/slack-events.ts`
  - `createSlackRelayWebhookRoutes` — `src/routes/slack-relay-webhooks.ts`
    (note: this route currently awaits `onAcceptedRelay` synchronously,
    `src/routes/slack-relay-webhooks.ts:104` — decide whether relay webhooks
    also move to the queue or stay synchronous; read that file before
    deciding, it may be intentionally synchronous for a reason)
  - health/readiness probes
- Replace the current fire-and-forget in-process dispatch
  (`Promise.resolve().then(() => eventRouter.dispatch(event))` in
  `src/routes/webhooks.ts:171-174`, and the equivalent in
  `src/routes/slack-events.ts`) with `await webhookQueue.enqueue(event)`
  before returning. Keep the existing shutdown-drain fallback to the
  Postgres `webhook_queue` table for enqueue failures — don't regress that
  safety net (runbook §9, risk #3).
- Keep the in-memory delivery-ID dedup (`src/webhook/dedup.ts`) exactly as
  today — it's correct here because the receiver stays a single
  min=max=1 instance.
- Does NOT need a Postgres connection, MCP server, ACA job launcher, or any
  of the review orchestration code — strip those out of its dependency graph
  so its container image and startup are genuinely minimal.

### 3. Worker app

- Everything currently in `src/index.ts` minus the webhook/Slack HTTP
  routes (those moved to the receiver): DB connection + migrations, MCP
  callback server, event router, review orchestration, ACA job dispatch,
  Azure Files workspace cleanup.
- New loop: instead of receiving events via HTTP, pull messages from the
  Storage Queue, reconstruct the `WebhookEvent`, and feed it into the
  existing `eventRouter.dispatch(event)` — the router and everything
  downstream of it should need **zero changes**.
- Delete the message only after `dispatch` resolves (success or
  handled failure) — use `run_state`'s unique `run_key` as the natural
  idempotency check if a message gets redelivered (visibility timeout
  expiry, worker restart, etc.) rather than adding new dedup state.
- Still needs `/healthz`/`/readiness` for ACA probes, and still serves
  `/internal/mcp/:serverName` for agent job callbacks — unchanged.

### 4. `deploy.sh` changes

- Provision the Storage Queue (main + poison) on `kodiaistg`.
- Split the current single Container App block (`deploy.sh:~800-965`) into
  two: receiver (small resources — start with `0.25` vCPU / `0.5Gi`) and
  worker (keep current `1.75` vCPU / `3.5Gi` via existing `ACA_CPU`/
  `ACA_MEMORY` env vars). Worker keeps `minReplicas=1, maxReplicas=1`
  (reuse the existing `ACA_MIN_REPLICAS`/`ACA_MAX_REPLICAS` guard logic at
  `deploy.sh:97-121` — it should still refuse `ACA_MAX_REPLICAS > 1` for the
  worker, since the MCP registry constraint hasn't changed).
- Receiver needs its own ingress/probes; worker keeps ingress only for the
  MCP callback path (`/internal/mcp/*`) plus probes — it no longer needs
  public ingress for webhooks.
- Both need the storage queue connection info wired in (managed identity,
  matching how other Azure resource access is configured in this script).
- Keep the whole script idempotent/re-runnable, matching its existing style
  (see the header comment in `deploy.sh` — it explicitly documents this
  property; don't break it).

## Tests to add/update

- Update whichever tests currently assert the fire-and-forget dispatch
  behavior in `src/routes/webhooks.ts`/`src/routes/slack-events.ts` (check
  `src/index.test.ts` and any route-level tests) to assert enqueue instead.
- New test for the poison-queue/dequeue-count logic.
- New test proving a redelivered message (simulate visibility-timeout
  expiry) doesn't produce a duplicate published review comment — this
  should be provable using the existing `run_state`/idempotency machinery,
  which is the point of reusing it.
- `scripts/deploy.test.ts` already exists and presumably asserts things
  about the current single-app `deploy.sh` shape — update it for the
  two-app topology.

## Acceptance criteria

- A GitHub or Slack webhook delivered to the receiver gets acked within the
  same latency envelope as today (no LLM/Octokit work happens before the
  200/ack).
- The worker processes queued messages and produces identical review output
  to today's in-process dispatch — no behavior change to review orchestration.
- Killing the worker mid-processing and letting the queue redeliver the
  message does not produce a duplicate published comment.
- `deploy.sh` run twice in a row is a no-op the second time (idempotency
  preserved).
- Worker is provably capped at 1 replica (`ACA_MAX_REPLICAS` guard still
  rejects >1).

Do not implement `minReplicas=0` on the worker in this change — that's
explicitly deferred to the next milestone per the rollout plan in
`docs/runbooks/azure-cost-architecture-review.md` §9.

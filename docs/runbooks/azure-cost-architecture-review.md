# Azure Cost & Architecture Review — Webhook/Worker Split

Deep-dive requested to evaluate splitting `ca-kodiai` into a tiny always-on
webhook receiver plus a queue-backed, scale-to-zero worker, comparing an
ACA-only variant (Option 3) against an Azure Functions receiver variant
(Option 4), against staying on the current reduced always-on app.

All code references below were verified against this branch
(`consolidated-review-fixes`) on 2026-07-08.

## 0. Ground truth used for this review

**Current spend (30-day, from cost export):**

| Resource | Cost | Notes |
| --- | --- | --- |
| `ca-kodiai` (main app) | $46.31 | min=1, max=1, 1.75 vCPU / 3.5Gi (`deploy.sh:97-129`) |
| `caj-kodiai-agent` (ACA job) | $1.61 | Manual trigger, no CPU/mem override → ACA default 0.5 vCPU/1Gi (`deploy.sh:504-561`) |
| PostgreSQL `kodiai-pg` | $15.83 | Burstable B1ms, Premium SSD (P4, 32Gi) (`scripts/provision-postgres.sh:23-60`) |
| Storage `kodiaistg` | $14.58 | Standard_LRS, ~11.1M transactions/mo |
| ACR Basic | $6.05 | |
| Key Vault / Log Analytics | ~$0 | |
| **Total `rg-kodiai`** | **$84.43** | |

**Utilization:** app CPU p95 2.23% / max 53.8%; app memory avg 38% / p95 70% /
max 77.9%; ~17,389 HTTP requests/month (~24/hour average, so nearly all
wall-clock time has zero in-flight requests); Postgres CPU avg 13% / p95
14.8%; Postgres storage 16.7% of 32Gi (~5.3GB actually used).

**Verified Azure pricing (fetched 2026-07-08, Microsoft Learn / azure.microsoft.com):**

| Meter | Rate |
| --- | --- |
| ACA Consumption — active vCPU-second | $0.000024 |
| ACA Consumption — active GiB-second | $0.000003 |
| ACA Consumption — **idle** vCPU-second (min-replica app, no active request, CPU<0.01 vCPU, <1000B/s net) | $0.000008 |
| ACA Consumption — **idle** GiB-second | $0.000001 |
| ACA free grant (per subscription/month, shared across ALL apps+jobs) | 180,000 vCPU-s, 360,000 GiB-s, 2M requests |
| ACA Jobs | **Always billed at active rate — no idle discount, no request charge (jobs have no ingress)** |
| Azure Functions Consumption | $0.40/M executions, ~$0.000016–0.000020/GB-s (region-dependent); free grant 1M executions + 400,000 GB-s/month |
| Storage Queue (LRS) | $0.0004/10,000 operations; storage $0.045/GB-month |
| Service Bus Standard | **$10/month fixed base fee**, includes ~12.5M operations/month, then metered beyond |
| Service Bus Basic | No base fee, ~$0.05/M operations, no sessions/dedup/topics |
| Postgres Flexible Server storage | **Premium SSD or Premium SSD v2 only — confirmed no Standard HDD/SSD tier exists** (Microsoft Learn, `concepts-storage`) |

**Load-bearing insight — the idle-rate discount already did most of the "obvious" work.**
Back-calculating from the $46.31 observed bill against 1.75 vCPU/3.5Gi
allocated 24/7 (~4.60M vCPU-s, ~9.20M GiB-s/month) only reconciles if the
active/idle split is roughly **2–3% active, 97–98% idle** — which lines up
almost exactly with the observed CPU p95 of 2.23%. In other words, ACA is
already billing this app at the cheap idle rate essentially all the time it
isn't actively handling a request or polling a job. This changes the framing
of the whole exercise: **the win from Option 3/4 isn't "stop paying for idle
time" (Azure already discounts that ~3x) — it's shrinking the *size* of the
footprint that idle-rate billing applies to**, and moving the truly
active-rate compute (LLM calls, job polling, MCP callback serving) onto a
worker that can go to **zero** instead of merely idle.

## 1. Current architecture (verified from code)

- **GitHub webhook** (`src/routes/webhooks.ts:40-177`): sig verify →
  in-memory delivery-ID dedup (`src/webhook/dedup.ts`, 24h TTL, 50k cap) →
  fire-and-forget dispatch (`Promise.resolve().then(() =>
  eventRouter.dispatch(event))`, `:171-174`) → **200 returned before the
  handler runs**, explicitly to dodge GitHub's 10s webhook timeout (`:167`).
  During shutdown, events are durably spilled into a Postgres `webhook_queue`
  table (`:147`) — this is the closest existing primitive to a real queue.
- **Slack Events API** (`src/routes/slack-events.ts:58-206`): same
  ack-then-dispatch shape; also spills to `webhook_queue` on async failure.
- **Event routing**: `src/webhook/router.ts` — in-process `Map` of handlers,
  `Promise.allSettled` fan-out.
- **MCP callback token registry** — `src/execution/mcp/http-server.ts:84-169`,
  `createMcpJobRegistry()` — a plain `Map<string, McpJobEntry>`, **the actual
  cause of `maxReplicas=1`** per the guard at `deploy.sh:107-121`. Each
  dispatched review mints a random bearer token, registers it against
  in-memory closures (`factories: Record<string, () => ...>` bound to
  `getOctokit`/`onPublish`/etc. — **not serializable**), and the ACA agent
  job calls back into `/internal/mcp/:serverName` with that token while it
  runs. Unregistered on completion/failure/timeout (`src/execution/executor.ts:823-948`).
- **ACA job dispatch** (`src/jobs/aca-launcher.ts`): hand-rolled Azure
  Management REST calls (no `@azure/*` SDK in `package.json`) to start
  `caj-kodiai-agent`, then `pollUntilComplete()` (`:395-524`) — **the
  orchestrator process blocks/polls every 5s until the job finishes**, up to
  a 1860s replica timeout. Result comes back two ways: `result.json` on the
  shared Azure Files workspace, *and* live MCP callbacks during the poll.
- **Azure Files cleanup**: already fixed to run in the background
  (`src/index.ts:109-123`, `scheduleAzureFilesWorkspaceCleanup()`, not
  awaited) — confirmed, not something this review needs to redo.
- **Postgres**: `run_state` table (unique `run_key`) already durably tracks
  review-run lifecycle/supersession — this is the one piece of session state
  that's *already* multi-replica-safe. The genuinely process-local state is:
  MCP token registry, `webhook/dedup.ts`, `jobs/review-work-coordinator.ts`
  (per-PR attempt claims), and `jobs/queue.ts` (in-process `p-queue` lanes).
- **Deploy**: no KEDA/custom scale rule exists anywhere — the app just runs
  at a fixed replica count (`deploy.sh:862-864`). No `@azure/storage-queue`,
  `@azure/service-bus`, or `@azure/functions` dependency exists yet.
- Reconciling job spend: at ACA's default job size (0.5 vCPU/1Gi, no
  override in `deploy.sh:504-561`) and the always-active job rate, $1.61/month
  implies **~30 execution-hours/month**. At a plausible 5–10 min average job
  wall time, that's **~180–360 review jobs/month (~6–12/day)** — useful for
  sizing the worker below.

## 2. Cost model for Option 3 (tiny ACA receiver + scale-to-zero ACA worker)

**Receiver**: 0.25 vCPU / 0.5Gi, min=1/max=1, does only sig-verify + dedup +
enqueue — no LLM/Octokit work, so it's active for milliseconds per request
and idle-billed almost 100% of the time.

- Idle compute (net of its share of the free grant): ≈ **$4–6/month**
- Requests: 17,389/month is far under the 2M free grant → **$0**

**Worker**: keep it sized like today (1.75 vCPU/3.5Gi) since it still runs
LLM orchestration, Octokit calls, DB access, and serves MCP callbacks while
blocking on `pollUntilComplete`. With `minReplicas=0`, it's billed **active
rate only for the wall-clock time it's actually running** — which is
dominated by review-processing time, not request count (KEDA queue scalers
wake it on message arrival; it scales back to 0 after a cooldown once the
queue drains).

- At ~180–360 reviews/month and ~6–11 min of worker wall-time per review
  (webhook handling + blocking-poll during the agent job): **≈ $3–15/month**
  in active-rate compute, plus a cooldown-overhead buffer → **call it $5–16/month**.

**Queue** (Storage Queue): ~3 operations/message (enqueue, dequeue, delete) ×
17,389–35,000 messages/month → **well under $1/month**.

**ACA agent jobs**: unchanged, **$1.61/month** (doubles with job volume).

| Scenario | Receiver | Worker | Queue | Jobs | **Total** | vs. current $47.92 (app+jobs) |
| --- | --- | --- | --- | --- | --- | --- |
| Current baseline | — | — | — | — | $46.31 + $1.61 | — |
| Option 3, current volume | ~$5 | ~$5–16 | <$1 | $1.61 | **~$12–23/mo** | ~50–75% lower |
| Option 3, webhook volume ×2 | ~$5 | ~$5–16 (unchanged — receiver work is what scales, and it's ~free) | <$1 | $1.61 | **~$12–23/mo** | negligible extra cost |
| Option 3, review/job volume ×2 | ~$5 | ~$10–30 | <$1 | $3.22 | **~$19–38/mo** | still well below baseline |

Webhook-volume doubling is nearly free under this design because the
receiver's cost driver is idle allocation size, not request count, and
requests stay far under the 2M free grant either way. Review/job-volume
doubling is the real cost driver, because that's what makes the worker
actually run at the active rate.

Net effect on the $84.43 total resource-group bill: roughly **$84 → $55–65/month**
at current volume (app/job line drops ~$25–36; Postgres/Storage/ACR
untouched by this specific change — see §9 for adjacent opportunities).

## 3. Cost model for Option 4 (Azure Functions receiver + same worker)

Functions Consumption pricing at this volume is essentially free: even at
10x today's traffic (170k executions, ~200ms × 256MB each ≈ 8,700 GB-s),
you're still inside the 1M-execution / 400,000 GB-s free grant. So Option 4
saves the **receiver's ~$4–6/month** relative to Option 3 — a genuinely
marginal difference — in exchange for meaningfully more engineering risk:

- **Bun isn't a supported Azure Functions runtime.** The receiver would need
  to be ported to Node.js (or run as a custom-container Functions app, which
  gives back most of the cost/complexity advantage over just using a tiny
  ACA app). This is real porting work for the signature-verify/dedup/enqueue
  path specifically, not a config change.
- **Cold starts.** Functions Consumption cold start is commonly 1–10s (more
  under memory pressure or infrequent invocation, which is exactly this
  traffic pattern — ~24 req/hour means the instance is very likely to have
  gone cold between requests). That eats directly into GitHub's 10s and
  especially Slack's **3-second** ack budget with much less margin than
  today's warm always-on process.
- Two deployment/build/observability surfaces instead of one, for a
  single-digit-dollar delta.

**Recommendation embedded in this section**: Option 4's receiver swap is not
worth it at this traffic level. If Functions is adopted at all, it should be
considered only if/when webhook volume grows enough that the *worker*
(not the receiver) becomes the cost question — and even then, ACA Jobs
already cover bursty/consumption-style execution for the heavy work, so
there's no clear gap Functions fills here.

## 4. Preserving webhook ack reliability

Both options keep the exact same synchronous-checks-then-async-dispatch
shape that exists today (`src/routes/webhooks.ts:40-177`,
`src/routes/slack-events.ts:58-206`) — the only change is that "dispatch"
becomes "enqueue" instead of an in-process `Promise.resolve().then(...)`:

1. Rate limit → signature verify → delivery-ID dedup (unchanged, in-memory,
   fine because the receiver stays a single min=max=1 instance).
2. Enqueue to Storage Queue (typically <100ms) instead of firing the
   in-process dispatch.
3. Return 200 immediately — same GitHub 10s / Slack 3s ack margin as today,
   arguably with *more* margin since the receiver no longer shares a process
   with LLM/Octokit work that could momentarily starve the event loop.
4. Keep the existing `webhook_queue` Postgres table as a shutdown-safety
   fallback for the receiver itself (unchanged use case, just now guarding
   queue-enqueue failures instead of dispatch failures).

## 5. Idempotency, dedup, retry, dead-letter

Most of this already exists and needs no redesign:

- **Delivery-level dedup**: `src/webhook/dedup.ts` in-memory cache stays on
  the receiver exactly as-is (receiver is still single-instance).
- **Review-output idempotency**: `review-orchestration/review-idempotency.ts`
  (`ensureReviewOutputNotPublished`) checks **GitHub itself** for the
  published marker, not a local flag — this is already safe against a queue
  redelivering a message and the worker reprocessing it. This is the
  strongest existing asset for a queue-based redesign: **the worker can be
  naively at-least-once and still be safe**, because the publish path is
  self-deduplicating against GitHub state.
- **`run_state` (unique `run_key`)** already gives durable run-lifecycle
  tracking across restarts — reuse it as the queue-message idempotency key
  rather than inventing a new one.
- **Retry**: rely on Storage Queue visibility timeout — set it comfortably
  above the max review wall-time (~35 min, matching the 1860s ACA job replica
  timeout) so a crashed/killed worker replica's message becomes redeliverable
  automatically, no custom retry scheduler needed.
- **Dead-letter**: Storage Queue has no native DLQ — implement the standard
  poison-message pattern using the queue message's `dequeueCount` (check on
  dequeue, move to a `-poison` queue and alert after N attempts, e.g. 5).
  This is a small, well-understood amount of new code, not a gap that
  requires Service Bus.

## 6. Storage Queue vs. Service Bus

**Storage Queue is enough here.** At 17k–70k messages/month, either option's
absolute cost is a rounding error — but Service Bus Standard's **$10/month
fixed base fee** is bigger than the *entire* projected receiver+worker+queue
cost of Option 3 at current volume. Service Bus's differentiators (sessions,
built-in duplicate detection, native DLQ, guaranteed FIFO, larger 256KB
messages) don't map to a real gap here:

- Ordering: the repo already has supersession logic (`run_state.superseded_by`,
  `review-work-coordinator.ts`) that tolerates out-of-order webhook delivery,
  so Service Bus sessions/FIFO buy nothing.
- Dedup: already solved at the GitHub-truth layer (§5), so Service Bus
  duplicate detection is redundant.
- DLQ: a `dequeueCount`-based poison queue is trivial to add to Storage Queue.
- Message size: webhook payloads/queue messages here are small metadata
  pointers (repo/PR/delivery-id), not full payloads — 64KB is not a
  constraint.

Service Bus becomes worth revisiting only if job/webhook volume grows by
roughly two orders of magnitude (at which point its $10 base amortizes) or if
a real need for sessions/guaranteed ordering emerges — neither is close today.

## 7 & 8. MCP callback registry — what it actually constrains

The registry constrains **replica count of whichever process serves
`/internal/mcp/:serverName`**, not webhook throughput and not job count.
Concretely:

- The registry is a plain in-memory `Map` holding **non-serializable
  closures** (`factories: Record<string, () => McpSdkServerConfigWithInstance>`
  bound to live `getOctokit`/`onPublish` callbacks). A real move to shared
  storage isn't "swap the Map for Redis" — it means persisting the *inputs*
  to `buildMcpServerFactories` (owner/repo/PR/comment IDs, etc.) and
  reconstructing factories on whichever replica receives a given callback,
  plus either sticky-session ingress or replica-affinity so a job's callbacks
  keep landing on a replica that can serve them.
- **This migration is NOT required for the first milestone.** If the worker's
  scale rule is capped at `maxReplicas=1` (scale strictly 0↔1, KEDA queue
  trigger with `activationConcurrency`/cooldown ensuring only one instance is
  ever up at a time), the exact single-instance assumption the registry
  relies on today is preserved — you get 100% of the scale-to-zero savings
  in §2 with **zero changes to `http-server.ts`**.
- The registry migration **only becomes mandatory** if you later want the
  worker to run more than one concurrent replica (e.g. to parallelize
  multiple simultaneous reviews beyond what one process + `p-queue` lanes
  handle). Given current volume (~6–12 reviews/day), there's no throughput
  case for that yet.
- **Real risk to watch, independent of the registry**: KEDA's queue-depth
  scaler has no visibility into "a review is still blocking on
  `pollUntilComplete` waiting for an agent job callback." The worker's
  `scaleDownDelay`/cooldown must be set to at least the max review wall-time
  (~35 min) so KEDA doesn't scale the single active replica to zero **while
  it's mid-review and still expected to serve MCP callbacks** — that failure
  mode would orphan a running ACA job with no one able to receive its
  callbacks. This is the sharpest correctness risk in Option 3/4 and needs
  explicit scale-rule tuning, not just "min=0, max=1."

## 9. Operational risks, rollout, rollback

**Risks, ranked:**

1. Premature scale-to-zero mid-review (above) — mitigate with conservative
   cooldown + integration test that holds a fake long-running job open and
   asserts the worker replica survives.
2. Receiver/worker split turns one deploy into two — `deploy.sh` needs real
   changes (two container app definitions, queue provisioning, KEDA scale
   rule, env wiring for queue connection). Budget this as the bulk of the
   actual engineering cost, not the Azure resource cost.
3. Queue-enqueue failure path needs the same shutdown-safety treatment the
   receiver already has for direct dispatch (§4) — don't regress the
   existing `webhook_queue` fallback.
4. Cold-start-adjacent latency on worker wake from zero — first message
   after idle period will see queue-poll-interval + container cold start
   added to review latency (Slack UX may notice this on `/kodiai` commands
   more than GitHub review latency, which is already async).

**Rollout plan:**

1. Ship the queue plumbing and worker split with `ACA_MAX_REPLICAS=1` fixed
   (no registry change) and `minReplicas=1` on the worker initially — i.e.,
   validate the receiver/queue/worker wiring *before* touching scale-to-zero
   at all. This isolates "did the split work" from "does scale-to-zero work."
2. Flip the worker to `minReplicas=0` behind an env flag, with the cooldown
   tuned per §8, and watch a full week of real review traffic (including at
   least one job that runs close to the 1860s timeout) before calling it done.
3. Only then consider shrinking the receiver's resources further or
   revisiting Service Bus/registry migration if volume has grown.

**Rollback plan:** because `deploy.sh` is already idempotent/re-runnable,
rollback is redeploying the current single-app topology with
`ACA_MIN_REPLICAS=1`/`ACA_MAX_REPLICAS=1` — keep the pre-split `deploy.sh`
and app image buildable from the previous tag until the split has run
cleanly in production for a full billing cycle. Postgres `run_state`/`webhook_queue`
schemas are additive, so no migration rollback is needed either direction.

## 10. Recommendation

**Do Option 3 first, with the registry migration deferred and worker capped
at `maxReplicas=1`. Do not do Option 4** at current or 2x traffic — the
Functions receiver saves roughly $4–6/month over a tiny ACA receiver while
adding a real Bun→Node port, cold-start risk against Slack's 3s ack budget,
and a second deployment surface. That trade isn't close.

**Smallest safe first milestone**: split the receiver and worker into two
ACA apps talking over a Storage Queue, with the worker pinned to
`minReplicas=1, maxReplicas=1` (no scale-to-zero yet, no MCP registry
change). This alone validates the queue plumbing, idempotency reuse
(`run_state` + GitHub-truth publish checks), and dead-letter handling with
zero blast-radius change to the callback model — and it's the prerequisite
for the scale-to-zero step in §2, which is where the real savings are.
Only after that milestone is stable in production should `minReplicas=0`
be enabled on the worker.

**Stay on the current reduced always-on app** only if the team isn't willing
to absorb the two-deploy operational overhead in §9 for a ~$25–36/month
saving on the app/job line (~30–40% of total `rg-kodiai` spend) — that's a
legitimate call if this isn't a priority right now, but the cost case for
doing it, once the queue split lands, is solid and low-risk **provided the
scale-down-cooldown risk in §8 is respected**.

**Adjacent, independent opportunity (not part of Options 3/4):** Postgres
storage is Premium SSD (P4, 32Gi) at 16.7% utilization (~5.3GB actual).
Premium SSD v2 (confirmed available for Flexible Server, §0) allows granular
capacity/IOPS sizing instead of the fixed P-series step, and Microsoft's own
guidance is that it's "less costly as a general rule" than Premium SSD for
general-purpose workloads. Worth a separate, low-risk pass independent of
the webhook/worker split — note storage can only be scaled up, not down, so
this needs sizing care up front, but switching storage *type* (Premium →
Premium SSD v2) at the same or smaller capacity is a config change, not a
migration.

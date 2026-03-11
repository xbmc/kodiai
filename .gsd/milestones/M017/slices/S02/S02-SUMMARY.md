---
id: S02
parent: M017
milestone: M017
provides:
  - "PostgreSQL-aware /healthz liveness probe with SELECT 1 check"
  - "Startup webhook queue replay processing queued webhooks before accepting traffic"
  - "Deploy script with DATABASE_URL, SHUTDOWN_GRACE_MS, health probes, termination grace period"
  - "Operator runbook for graceful deploy procedure and troubleshooting"
  - "webhook_queue table for durable webhook queuing during shutdown drain"
  - "RequestTracker for in-flight HTTP request and background job counting"
  - "ShutdownManager with SIGTERM/SIGINT handling and configurable grace window"
  - "WebhookQueueStore with PostgreSQL-backed enqueue/dequeue and telemetry integration"
requires: []
affects: []
key_files: []
key_decisions:
  - "/healthz runs SELECT 1 against PostgreSQL for liveness; /health kept as backward-compatible alias"
  - "Startup webhook replay processes sequentially to avoid overwhelming system on cold start"
  - "Termination grace period set to 330s (5min SHUTDOWN_GRACE_MS + 30s buffer)"
  - "Startup probe: periodSeconds=5, failureThreshold=40 (~200s for cold start with queue replay)"
  - "Grace window defaults to 5 minutes (SHUTDOWN_GRACE_MS env var), extends once (doubles) on timeout"
  - "Readiness probe stays healthy during drain per user decision (single replica must keep accepting)"
  - "Webhook queue telemetry uses fire-and-forget pattern to avoid blocking enqueue on telemetry writes"
patterns_established:
  - "PostgreSQL health check pattern: SELECT 1 for liveness probes"
  - "Startup queue replay: dequeue pending webhooks and dispatch before accepting new traffic"
  - "Post-deploy health verification: curl /healthz with retry loop after deploy"
  - "Lifecycle module pattern: src/lifecycle/ for shutdown, tracking, and queuing concerns"
  - "Drain-time webhook queuing: routes check shutdownManager.isShuttingDown() before dispatching"
  - "Background job tracking: requestTracker.trackJob() wraps fire-and-forget async work"
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-24
blocker_discovered: false
---
# S02: Graceful Shutdown Deploy Hardening

**# Phase 87 Plan 02: Deploy Hardening Summary**

## What Happened

# Phase 87 Plan 02: Deploy Hardening Summary

**PostgreSQL-aware health probes, startup webhook queue replay, Azure deploy with termination grace period, and operator runbook**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-24T21:27:22Z
- **Completed:** 2026-02-24T21:31:37Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- /healthz liveness probe checks PostgreSQL connectivity via SELECT 1, returns 503 if unreachable
- Startup replays queued webhooks (GitHub and Slack) sequentially before accepting new traffic with structured log summary
- deploy.sh passes DATABASE_URL as secret, SHUTDOWN_GRACE_MS as env var, uses /healthz for all probes
- Azure termination grace period configured to 330s matching SHUTDOWN_GRACE_MS default plus buffer
- Post-deploy health check with retry loop and rollback instructions on failure
- Operator runbook documents full shutdown flow, deploy procedure, troubleshooting, and monitoring

## Task Commits

Each task was committed atomically:

1. **Task 1: Update health probes and implement startup webhook queue replay** - `2972d42a7c` (feat)
2. **Task 2: Update deploy script and create graceful restart runbook** - `36d39b2c58` (feat)

## Files Created/Modified
- `src/routes/health.ts` - /healthz with PostgreSQL SELECT 1 check, /health alias, /readiness unchanged
- `src/index.ts` - Startup webhook queue replay: dequeue pending, dispatch by source, log summary
- `deploy.sh` - DATABASE_URL secret, SHUTDOWN_GRACE_MS env var, /healthz probes, termination-grace-period=330, post-deploy health check
- `docs/GRACEFUL-RESTART-RUNBOOK.md` - Operator runbook: shutdown flow, deploy procedure, troubleshooting, monitoring, environment vars

## Decisions Made
- /healthz runs SELECT 1 against PostgreSQL for liveness (simple, reliable, catches pool exhaustion)
- /health kept as backward-compatible alias during deploy transition (both endpoints return same response)
- Startup webhook replay processes sequentially (not parallel) to avoid overwhelming the system on cold start
- GitHub webhooks reconstructed as WebhookEvent and dispatched through eventRouter; Slack webhooks reconstructed as SlackAssistantAddressedPayload
- Termination grace period set to 330s (SHUTDOWN_GRACE_MS default 300s + 30s buffer for cleanup)
- Startup probe: periodSeconds=5, failureThreshold=40 gives ~200s for cold start including queue replay

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - DATABASE_URL is already required by the application. SHUTDOWN_GRACE_MS is optional (defaults to 300000ms).

## Next Phase Readiness
- Phase 87 (Graceful Shutdown + Deploy Hardening) is fully complete
- All lifecycle infrastructure in place: shutdown drain, webhook queuing, startup replay, health probes, deploy configuration
- Operator runbook provides documentation for deploy operations

---
*Phase: 87-graceful-shutdown-deploy-hardening*
*Completed: 2026-02-24*

# Phase 87 Plan 01: Graceful Shutdown Core Summary

**SIGTERM drain with configurable grace window, in-flight work tracking, and PostgreSQL webhook queuing during shutdown**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-24T21:21:08Z
- **Completed:** 2026-02-24T21:25:24Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- SIGTERM/SIGINT handlers installed at startup with configurable grace window (5min default, SHUTDOWN_GRACE_MS)
- In-flight HTTP requests and background jobs tracked for drain awareness
- New webhooks (GitHub and Slack) durably queued to PostgreSQL webhook_queue table during shutdown
- Grace window extends once (doubles) on timeout; force-exits code 1 logging abandoned work count
- Telemetry events (webhook_queued, webhook_replayed) recorded per locked decision

## Task Commits

Each task was committed atomically:

1. **Task 1: Create webhook_queue migration, lifecycle types, and webhook queue store** - `8b09266d6e` (feat)
2. **Task 2: Create request tracker and shutdown manager with SIGTERM wiring** - `49e7d8e939` (feat)

## Files Created/Modified
- `src/db/migrations/004-webhook-queue.sql` - webhook_queue table with pending index
- `src/db/migrations/004-webhook-queue.down.sql` - Rollback for webhook_queue
- `src/lifecycle/types.ts` - RequestTracker, ShutdownManager, WebhookQueueEntry, WebhookQueueStore interfaces
- `src/lifecycle/webhook-queue-store.ts` - PostgreSQL-backed webhook queue with telemetry integration
- `src/lifecycle/request-tracker.ts` - In-flight request and job counter with waitForDrain
- `src/lifecycle/shutdown-manager.ts` - SIGTERM handler with drain logic and grace window extension
- `src/index.ts` - Wired lifecycle infrastructure at startup
- `src/routes/webhooks.ts` - Drain-time queuing for GitHub webhooks, job tracking for dispatches
- `src/routes/slack-events.ts` - Drain-time queuing for Slack events, job tracking for bootstrap

## Decisions Made
- Grace window defaults to 5 minutes via SHUTDOWN_GRACE_MS, extends once (doubles) on timeout per plan spec
- Readiness probe stays healthy during drain (single replica must keep accepting webhooks into the queue)
- Webhook queue telemetry uses fire-and-forget void pattern to avoid blocking enqueue on telemetry writes
- Slack events route deps (shutdownManager, webhookQueueStore, requestTracker) are optional to avoid breaking existing tests

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. SHUTDOWN_GRACE_MS env var is optional (defaults to 300000ms).

## Next Phase Readiness
- Shutdown infrastructure complete, ready for Plan 02 (webhook replay on startup, integration testing)
- webhook_queue table and store provide the foundation for startup replay logic

---
*Phase: 87-graceful-shutdown-deploy-hardening*
*Completed: 2026-02-24*

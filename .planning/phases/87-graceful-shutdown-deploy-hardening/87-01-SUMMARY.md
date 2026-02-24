---
phase: 87-graceful-shutdown-deploy-hardening
plan: 01
subsystem: infra
tags: [sigterm, graceful-shutdown, webhook-queue, postgresql, drain, lifecycle]

# Dependency graph
requires:
  - phase: 86-postgresql-migration
    provides: "PostgreSQL connection pool, migration framework, telemetry store"
provides:
  - "webhook_queue table for durable webhook queuing during shutdown drain"
  - "RequestTracker for in-flight HTTP request and background job counting"
  - "ShutdownManager with SIGTERM/SIGINT handling and configurable grace window"
  - "WebhookQueueStore with PostgreSQL-backed enqueue/dequeue and telemetry integration"
affects: [87-02, deploy, ops, webhook-replay]

# Tech tracking
tech-stack:
  added: []
  patterns: [graceful-shutdown-drain, webhook-queuing-during-drain, signal-handler-registration]

key-files:
  created:
    - src/db/migrations/004-webhook-queue.sql
    - src/db/migrations/004-webhook-queue.down.sql
    - src/lifecycle/types.ts
    - src/lifecycle/webhook-queue-store.ts
    - src/lifecycle/request-tracker.ts
    - src/lifecycle/shutdown-manager.ts
  modified:
    - src/index.ts
    - src/routes/webhooks.ts
    - src/routes/slack-events.ts

key-decisions:
  - "Grace window defaults to 5 minutes (SHUTDOWN_GRACE_MS env var), extends once (doubles) on timeout"
  - "Readiness probe stays healthy during drain per user decision (single replica must keep accepting)"
  - "Webhook queue telemetry uses fire-and-forget pattern to avoid blocking enqueue on telemetry writes"

patterns-established:
  - "Lifecycle module pattern: src/lifecycle/ for shutdown, tracking, and queuing concerns"
  - "Drain-time webhook queuing: routes check shutdownManager.isShuttingDown() before dispatching"
  - "Background job tracking: requestTracker.trackJob() wraps fire-and-forget async work"

requirements-completed: [DEP-01, DEP-02, DEP-03]

# Metrics
duration: 4min
completed: 2026-02-24
---

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

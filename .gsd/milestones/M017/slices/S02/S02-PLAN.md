# S02: Graceful Shutdown Deploy Hardening

**Goal:** Implement SIGTERM handling, in-flight work tracking, drain logic with configurable grace window, and durable webhook queuing during shutdown.
**Demo:** Implement SIGTERM handling, in-flight work tracking, drain logic with configurable grace window, and durable webhook queuing during shutdown.

## Must-Haves


## Tasks

- [x] **T01: 87-graceful-shutdown-deploy-hardening 01** `est:4min`
  - Implement SIGTERM handling, in-flight work tracking, drain logic with configurable grace window, and durable webhook queuing during shutdown.

Purpose: When the server receives SIGTERM (deploy or manual stop), it must drain in-flight HTTP requests and background jobs cleanly, queue any new incoming webhooks to PostgreSQL for replay after restart, and exit gracefully.

Output: Migration for webhook_queue table, shutdown manager, request tracker, webhook queue store, and wiring in index.ts.
- [x] **T02: 87-graceful-shutdown-deploy-hardening 02** `est:4min`
  - Update health probes for PostgreSQL-aware liveness, implement startup webhook queue replay, configure Azure deploy for auto-rollback, and document the graceful restart procedure.

Purpose: Complete the deploy hardening story: health probes catch unhealthy containers, queued webhooks from the drain period are replayed on startup, Azure is configured for safe single-replica deploys, and operators have a runbook.

Output: Updated health routes, startup queue replay in index.ts, deploy.sh with health probes and SHUTDOWN_GRACE_MS, graceful restart runbook.

## Files Likely Touched

- `src/db/migrations/004-webhook-queue.sql`
- `src/db/migrations/004-webhook-queue.down.sql`
- `src/lifecycle/shutdown-manager.ts`
- `src/lifecycle/request-tracker.ts`
- `src/lifecycle/webhook-queue-store.ts`
- `src/lifecycle/types.ts`
- `src/index.ts`
- `src/routes/health.ts`
- `src/index.ts`
- `deploy.sh`
- `docs/GRACEFUL-RESTART-RUNBOOK.md`

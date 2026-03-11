# T01: 87-graceful-shutdown-deploy-hardening 01

**Slice:** S02 — **Milestone:** M017

## Description

Implement SIGTERM handling, in-flight work tracking, drain logic with configurable grace window, and durable webhook queuing during shutdown.

Purpose: When the server receives SIGTERM (deploy or manual stop), it must drain in-flight HTTP requests and background jobs cleanly, queue any new incoming webhooks to PostgreSQL for replay after restart, and exit gracefully.

Output: Migration for webhook_queue table, shutdown manager, request tracker, webhook queue store, and wiring in index.ts.

## Must-Haves

- [ ] "SIGTERM causes the server to stop accepting new work and drain in-flight requests/jobs before exiting"
- [ ] "Grace window defaults to 5 minutes and is configurable via SHUTDOWN_GRACE_MS"
- [ ] "If grace window expires with work in-flight, it extends once (doubles), then force-exits with code 1"
- [ ] "New webhooks arriving during drain are accepted and queued to PostgreSQL webhook_queue table"
- [ ] "Force exit logs what was abandoned"

## Files

- `src/db/migrations/004-webhook-queue.sql`
- `src/db/migrations/004-webhook-queue.down.sql`
- `src/lifecycle/shutdown-manager.ts`
- `src/lifecycle/request-tracker.ts`
- `src/lifecycle/webhook-queue-store.ts`
- `src/lifecycle/types.ts`
- `src/index.ts`

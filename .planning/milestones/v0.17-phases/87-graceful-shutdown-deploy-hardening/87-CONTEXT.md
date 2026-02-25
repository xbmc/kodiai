# Phase 87: Graceful Shutdown + Deploy Hardening - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Server handles SIGTERM gracefully, drains in-flight work, queues new webhooks during drain, and Azure deploys cause zero dropped webhooks. Single-replica deployment — no multi-replica rolling strategy.

</domain>

<decisions>
## Implementation Decisions

### Drain behavior
- In-flight work includes both active HTTP request handlers AND background jobs (embedding generation, learning memory writes, etc.)
- On SIGTERM: stop processing new work, let in-flight HTTP requests and background jobs complete
- New webhooks arriving during drain are accepted and queued to a PostgreSQL `webhook_queue` table — durable across restarts
- Grace window defaults to 5 minutes (`SHUTDOWN_GRACE_MS` env var)
- If grace window expires with work still in-flight: extend the window once (double it), then force exit if still not done
- Force exit logs what was abandoned and exits with code 1

### Health probe design
- Liveness probe (`/healthz`): checks process is up AND PostgreSQL connection pool is healthy
- Readiness probe stays healthy during drain — single replica must keep accepting webhooks into the queue
- Health check interval and failure thresholds: Claude's discretion based on webhook workload characteristics

### Deploy strategy
- Single-replica deployment — brief downtime gap during deploy is acceptable (GitHub/Slack will retry webhooks)
- Deploy trigger: manual (GitHub Actions dispatch or CLI command), NOT auto-deploy on main push
- CI builds the image on main push; deploy is a separate manual step
- Azure Container Apps configured to auto-rollback to previous revision if health checks fail on new deployment
- On startup after deploy: Claude decides optimal sequence for processing queued webhooks vs accepting new traffic

### Observability
- Structured drain log on SIGTERM: log signal received, count of in-flight requests, count of background jobs, estimated drain time
- No Slack notifications for shutdown/startup — silent deploys, rely on logs
- Webhook queue operations (queued, replayed) tracked as telemetry events in `telemetry_events` table with payload metadata
- Post-deploy startup summary: structured log with startup duration, count of queued webhooks processed, DB connection status

### Claude's Discretion
- Health check interval and failure threshold values
- Startup sequence for queue processing vs accepting new traffic
- Exact implementation of the grace window extension mechanism
- How to detect and enumerate "in-flight background jobs" at shutdown time

</decisions>

<specifics>
## Specific Ideas

- Single-replica constraint is key — no multi-replica rolling deploy complexity needed
- Webhook queue must be in PostgreSQL (already migrated to Postgres in Phase 86) for durability
- Brief deploy downtime acceptable because GitHub and Slack both retry failed webhook deliveries
- Manual deploy trigger preferred over continuous deployment for operator control

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 87-graceful-shutdown-deploy-hardening*
*Context gathered: 2026-02-24*

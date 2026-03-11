# T02: 87-graceful-shutdown-deploy-hardening 02

**Slice:** S02 — **Milestone:** M017

## Description

Update health probes for PostgreSQL-aware liveness, implement startup webhook queue replay, configure Azure deploy for auto-rollback, and document the graceful restart procedure.

Purpose: Complete the deploy hardening story: health probes catch unhealthy containers, queued webhooks from the drain period are replayed on startup, Azure is configured for safe single-replica deploys, and operators have a runbook.

Output: Updated health routes, startup queue replay in index.ts, deploy.sh with health probes and SHUTDOWN_GRACE_MS, graceful restart runbook.

## Must-Haves

- [ ] "Liveness probe at /healthz checks process is up AND PostgreSQL connection pool is healthy"
- [ ] "Readiness probe stays healthy during drain so single replica keeps accepting webhooks into the queue"
- [ ] "On startup after deploy, queued webhooks are replayed before accepting new traffic"
- [ ] "Azure Container Apps configured with health probes and auto-rollback on failed deployment"
- [ ] "Graceful restart runbook documents the deploy procedure and troubleshooting"

## Files

- `src/routes/health.ts`
- `src/index.ts`
- `deploy.sh`
- `docs/GRACEFUL-RESTART-RUNBOOK.md`

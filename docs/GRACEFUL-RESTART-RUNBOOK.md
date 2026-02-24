# Graceful Restart Runbook

Operator documentation for deploying kodiai with graceful shutdown and webhook queue replay.

## How Graceful Shutdown Works

When Azure sends SIGTERM (during a deploy or scale-down), kodiai follows this sequence:

1. **SIGTERM received** -- shutdown manager sets `isShuttingDown = true`
2. **Stop new work** -- new webhook dispatches are blocked; incoming webhooks are queued to PostgreSQL (`webhook_queue` table) instead of being dispatched
3. **Drain in-flight work** -- wait for active HTTP requests and background jobs to complete within the grace window
4. **Grace window** -- controlled by `SHUTDOWN_GRACE_MS` (default: 300000 = 5 minutes)
   - If drain times out, the grace window **extends once** (doubles to 10 minutes)
   - If extended drain also times out, the process **force-exits with code 1**, logging abandoned work counts
5. **Clean exit** -- close PostgreSQL connection pool, exit with code 0
6. **Next startup** -- queued webhooks are replayed sequentially before accepting new traffic

## Deploy Procedure

### Pre-deploy

Check for active reviews in container logs:

```bash
az containerapp logs show -n ca-kodiai -g rg-kodiai --tail 50 | grep "Job execution started"
```

If active reviews are running, consider waiting for them to complete or accept that they will be abandoned if they exceed the grace window.

### Deploy

Run the deploy script:

```bash
./deploy.sh
```

This script:
1. Validates required environment variables (including `DATABASE_URL`)
2. Builds the container image via Azure Container Registry (remote build)
3. Updates secrets and environment variables
4. Creates a new revision with the updated image
5. Runs a post-deploy health check against `/healthz`

Azure then:
1. Sends SIGTERM to the old revision
2. Waits for the termination grace period (330 seconds) before force-killing
3. Starts the new revision
4. Runs startup probe (`/healthz`, every 5s, up to 40 failures = ~200s for cold start with queue replay)

### Brief Downtime

With a single replica, there is a brief downtime gap between the old revision shutting down and the new revision becoming ready. This is acceptable because:

- **GitHub** retries webhooks that receive non-2xx responses
- **Slack** retries event deliveries that fail

Webhooks arriving during the drain period are queued to PostgreSQL and replayed on the next startup.

### Post-deploy

1. Verify the health endpoint returns 200:

```bash
curl -s https://<FQDN>/healthz | jq .
# Expected: { "status": "ok", "db": "connected" }
```

2. Check container logs for the startup summary:

```bash
az containerapp logs show -n ca-kodiai -g rg-kodiai --tail 20
# Look for: "Startup webhook queue replay complete" with queuedWebhooksProcessed count
```

## Troubleshooting

### Container stuck in drain

**Symptom:** Container takes a long time to shut down, logs show "Drain timeout, extending grace window once".

**Cause:** Long-running review jobs have not completed within the grace window.

**Resolution:**
- Check logs for active job counts: `activeRequests`, `activeJobs`, `activeTotal`
- If this happens frequently, consider reducing `SHUTDOWN_GRACE_MS` to force earlier exits
- The extended grace window (2x) gives additional time, after which the process force-exits

### Queued webhooks not replaying

**Symptom:** After deploy, webhooks from the drain period are not being processed.

**Cause:** Startup replay may have failed or there were no queued webhooks.

**Resolution:**
- Check logs for "Dequeued pending webhooks for replay" or "Startup webhook queue replay complete"
- Check the `webhook_queue` table for rows with status = 'pending' or 'processing'
- If rows are stuck in 'processing', they may need manual reset to 'pending'

```sql
-- Check queued webhooks
SELECT id, source, status, queued_at FROM webhook_queue ORDER BY queued_at DESC LIMIT 20;

-- Reset stuck processing entries (if needed)
UPDATE webhook_queue SET status = 'pending' WHERE status = 'processing';
```

### Health check failing after deploy

**Symptom:** `/healthz` returns 503 with `{ "status": "unhealthy", "db": "unreachable" }`.

**Cause:** PostgreSQL connection is not working.

**Resolution:**
- Verify `DATABASE_URL` is set correctly in the container app secrets
- Check PostgreSQL server is running and accessible from the container network
- Check connection pool limits (max 10 connections configured)
- Review container logs for PostgreSQL connection errors at startup

### Rollback to previous revision

If a deploy goes wrong, rollback to the previous revision:

```bash
# List revisions
az containerapp revision list -n ca-kodiai -g rg-kodiai -o table

# Route all traffic to the previous revision
az containerapp ingress traffic set \
  -n ca-kodiai -g rg-kodiai \
  --revision-weight <previous-revision-name>=100
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `SHUTDOWN_GRACE_MS` | No | `300000` (5 min) | Grace window for drain before force-exit |

All other required environment variables are documented in `deploy.sh`.

## Monitoring

### Key Log Messages

| Message | Meaning |
|---------|---------|
| `Shutdown signal received, starting graceful drain` | SIGTERM/SIGINT received, drain starting |
| `Graceful drain completed successfully` | All in-flight work finished, clean exit |
| `Drain timeout, extending grace window once` | First drain timed out, extending |
| `Force exit after extended grace timeout, work abandoned` | Both drain attempts failed |
| `Webhook queued to PostgreSQL for drain-time replay` | Webhook saved during shutdown |
| `Dequeued pending webhooks for replay` | Startup found queued webhooks |
| `Startup webhook queue replay complete` | All queued webhooks processed |
| `Health check failed: PostgreSQL unreachable` | DB connection issue on liveness probe |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Clean shutdown -- all work drained, DB closed |
| `1` | Forced shutdown -- extended grace timeout exceeded, some work abandoned |

### Health Probe Endpoints

| Endpoint | Type | What it checks |
|----------|------|----------------|
| `/healthz` | Liveness | Process up + PostgreSQL `SELECT 1` |
| `/readiness` | Readiness | GitHub API connectivity |
| `/health` | Alias | Same as `/healthz` (backward compatibility) |

---
id: T02
parent: S02
milestone: M017
provides:
  - "PostgreSQL-aware /healthz liveness probe with SELECT 1 check"
  - "Startup webhook queue replay processing queued webhooks before accepting traffic"
  - "Deploy script with DATABASE_URL, SHUTDOWN_GRACE_MS, health probes, termination grace period"
  - "Operator runbook for graceful deploy procedure and troubleshooting"
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 4min
verification_result: passed
completed_at: 2026-02-24
blocker_discovered: false
---
# T02: 87-graceful-shutdown-deploy-hardening 02

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

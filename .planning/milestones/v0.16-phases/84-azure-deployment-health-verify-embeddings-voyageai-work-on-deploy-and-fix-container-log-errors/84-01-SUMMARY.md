---
phase: 84-azure-deployment-health-verify-embeddings-voyageai-work-on-deploy-and-fix-container-log-errors
plan: 01
subsystem: infra
tags: [azure, voyageai, embeddings, slack, deployment, container-apps]

# Dependency graph
requires: []
provides:
  - Non-blocking embeddings smoke test on container boot
  - Complete env var passthrough in deploy.sh for all services
affects: [deployment, embeddings, slack]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-blocking smoke test using void Promise pattern for startup diagnostics"

key-files:
  created: []
  modified:
    - src/index.ts
    - deploy.sh

key-decisions:
  - "Smoke test uses void Promise pattern to avoid blocking server startup"
  - "Slack secrets (bot token, signing secret) passed as Azure Container Apps secrets via secretref"
  - "Slack config values (bot user ID, channel ID) passed as plain env vars"

patterns-established:
  - "Startup smoke tests: non-blocking, log pass/fail at INFO/WARN, never prevent boot"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-02-20
---

# Phase 84 Plan 01: Embeddings Smoke Test & Deploy Env Vars Summary

**Non-blocking VoyageAI embeddings smoke test on startup plus complete env var passthrough in deploy.sh for Voyage, Slack, and existing GitHub/Claude secrets**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-20T02:20:45Z
- **Completed:** 2026-02-20T02:22:14Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Embeddings smoke test runs on every container boot, logs pass/fail with model, dimensions, and latency
- deploy.sh now validates and passes all 9 required env vars (GitHub, Claude, VoyageAI, Slack)
- Smoke test is non-blocking -- server starts regardless of VoyageAI connectivity

## Task Commits

Each task was committed atomically:

1. **Task 1: Add embeddings startup smoke test** - `630e12a4dc` (feat)
2. **Task 2: Update deploy.sh env var passthrough** - `d4d227de2b` (feat)

## Files Created/Modified
- `src/index.ts` - Added non-blocking embeddings smoke test after provider initialization
- `deploy.sh` - Added VOYAGE_API_KEY, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET as secrets; SLACK_BOT_USER_ID, SLACK_KODIAI_CHANNEL_ID as plain env vars in validation, create, update, and YAML probe sections

## Decisions Made
- Smoke test uses `void Promise.resolve().then(...)` pattern consistent with the existing Slack scope preflight
- Slack secrets go through Azure Container Apps secret refs; non-secret config values are plain env vars
- Smoke test skips entirely when using the no-op provider (model === "none")

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Env vars must already be set in the deployment environment.

## Next Phase Readiness
- Container will now log embeddings status on boot for operator visibility
- All env vars wired for full-functionality deployment
- Ready for Phase 84 Plan 02 (container log error fixes)

## Self-Check: PASSED

- [x] src/index.ts exists
- [x] deploy.sh exists
- [x] Commit 630e12a4dc exists
- [x] Commit d4d227de2b exists

---
*Phase: 84-azure-deployment-health-verify-embeddings-voyageai-work-on-deploy-and-fix-container-log-errors*
*Completed: 2026-02-20*

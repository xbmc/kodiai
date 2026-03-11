---
id: S03
parent: M016
milestone: M016
provides:
  - Healthy Azure deployment with all services functional
  - sqlite-vec working in production (Dockerfile fix from Alpine to Debian)
  - Non-blocking embeddings smoke test on container boot
  - Complete env var passthrough in deploy.sh for all services
requires: []
affects: []
key_files: []
key_decisions:
  - "Switched Dockerfile from oven/bun:1-alpine to oven/bun:1-debian for sqlite-vec glibc compatibility"
  - "sqlite-vec ships glibc-linked vec0.so — Alpine musl cannot load it"
  - "Smoke test uses void Promise pattern to avoid blocking server startup"
  - "Slack secrets (bot token, signing secret) passed as Azure Container Apps secrets via secretref"
  - "Slack config values (bot user ID, channel ID) passed as plain env vars"
patterns_established:
  - "Use Debian base images when native extensions require glibc"
  - "Startup smoke tests: non-blocking, log pass/fail at INFO/WARN, never prevent boot"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-20
blocker_discovered: false
---
# S03: Azure Deployment Health Verify Embeddings Voyageai Work On Deploy And Fix Container Log Errors

**# Phase 84 Plan 02: Deploy to Azure, Verify Health, Triage Logs Summary**

## What Happened

# Phase 84 Plan 02: Deploy to Azure, Verify Health, Triage Logs Summary

**Deployed to Azure with Debian-based image fix, confirmed VoyageAI embeddings working, sqlite-vec loading, and clean startup with zero error-level output**

## Performance

- **Duration:** 5 min (plus deploy wait time)
- **Completed:** 2026-02-20
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Fixed sqlite-vec loading by switching Dockerfile from Alpine (musl) to Debian (glibc)
- Deployed successfully with all 9 env vars passed through
- Embeddings smoke test passed in production (171ms latency)
- Container startup is fully clean — zero error-level or warning-level lines
- Learning memory store now functional in production (was previously no-op due to sqlite-vec failure)

## Task Commits

1. **Dockerfile fix: Alpine → Debian** - `8356361df3` (fix)
2. **Deploy + verify** - deployment only, no file changes

## Files Created/Modified
- `Dockerfile` - Switched base image from `oven/bun:1-alpine` to `oven/bun:1-debian`, replaced `apk add` with `apt-get install` for git

## Decisions Made
- Root cause of sqlite-vec failure: vec0.so is compiled against glibc, Alpine only has musl libc
- Fix: switch to Debian base image which provides glibc
- Image size increase is acceptable tradeoff for native extension compatibility

## Deviations from Plan

- Plan expected sqlite-vec failure to be a pre-existing cosmetic issue; user identified it as needing a fix
- Added Dockerfile base image change (not in original plan) to resolve the root cause

## Production Health Verification

| Service | Status |
|---------|--------|
| sqlite-vec | ✓ Loaded v0.1.7-alpha.2 |
| Learning memory | ✓ Initialized (no longer no-op) |
| Embeddings smoke test | ✓ Passed (voyage-code-3, 1024 dims, 171ms) |
| Slack scope preflight | ✓ 6 scopes confirmed |
| GitHub App auth | ✓ Authenticated as kodiai |
| Health endpoint | ✓ HTTP 200 |
| Error-level lines | ✓ Zero |

## Issues Encountered
- VOYAGE_API_KEY was missing from .env (user added it)
- sqlite-vec failed on Alpine due to glibc/musl mismatch (fixed with Debian base image)

## Self-Check: PASSED

- [x] Dockerfile modified
- [x] Commit 8356361df3 exists
- [x] Container logs show clean startup
- [x] Embeddings smoke test passed in production
- [x] sqlite-vec loaded successfully

---
*Phase: 84-azure-deployment-health-verify-embeddings-voyageai-work-on-deploy-and-fix-container-log-errors*
*Completed: 2026-02-20*

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

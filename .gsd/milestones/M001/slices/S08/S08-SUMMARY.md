---
id: S08
parent: M001
milestone: M001
provides:
  - Multi-stage Dockerfile using oven/bun:1-alpine
  - .dockerignore excluding development-only files
  - Verified Docker image (274MB, non-root, git included)
  - Azure Container Apps deployment script (deploy.sh)
  - Live production deployment at ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
  - Health probes (liveness, readiness, startup)
  - Secrets management via Azure secretref
requires: []
affects: []
key_files: []
key_decisions:
  - "Alpine base image works -- agent-sdk bundles cli.js with musl support, no debian-slim fallback needed"
  - "No Claude CLI installation in Docker -- agent-sdk bundles cli.js which runs under bun"
  - "git installed via apk for workspace manager clone operations"
  - "USER bun for non-root execution; /tmp writable by default"
  - "274MB final image size (production deps only, no devDependencies)"
  - "ACR remote build (az acr build) used instead of local docker build + push"
  - "Managed identity with AcrPull role for registry auth (no admin credentials)"
  - "min-replicas 1 to prevent webhook timeouts from cold starts"
  - "GITHUB_PRIVATE_KEY_BASE64 passed through Azure secrets; app's loadPrivateKey() handles base64 decoding"
  - "Health probe YAML must include image and env vars to avoid overwrite by az containerapp update"
  - "Microsoft.ContainerRegistry provider must be registered before ACR creation"
  - "Explicit git refspec needed for base branch fetch in single-branch clones"
patterns_established:
  - "Multi-stage build: deps stage installs with --production --frozen-lockfile, production stage copies node_modules"
  - "Only COPY src/, package.json, bun.lock, tsconfig.json -- no development artifacts"
  - "Deploy via deploy.sh with 4 required env vars (GITHUB_APP_ID, GITHUB_PRIVATE_KEY_BASE64, GITHUB_WEBHOOK_SECRET, CLAUDE_CODE_OAUTH_TOKEN)"
  - "Redeploy: az acr build --registry kodiairegistry --image kodiai:vN . && az containerapp update --image kodiairegistry.azurecr.io/kodiai:vN"
observability_surfaces: []
drill_down_paths: []
duration: 15min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# S08: Deployment

**# Phase 8 Plan 1: Dockerfile and .dockerignore Summary**

## What Happened

# Phase 8 Plan 1: Dockerfile and .dockerignore Summary

**Multi-stage Docker build with oven/bun:1-alpine, production-only deps, non-root user, and git for workspace cloning (274MB image)**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-08T17:02:12Z
- **Completed:** 2026-02-08T17:03:34Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- Multi-stage Dockerfile builds production image with only runtime dependencies (no devDependencies)
- Docker image verified: builds cleanly, runs as non-root "bun" user, git available (v2.49.1)
- .dockerignore excludes node_modules, .git, tmp/, .planning/, .env files, and other development artifacts
- Image size is 274MB -- within expected range for Bun + production deps + git on Alpine

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Dockerfile and .dockerignore** - `808a215` (feat)
2. **Task 2: Build Docker image and verify health endpoint** - verification only, no file changes

## Files Created/Modified
- `Dockerfile` - Multi-stage build: deps stage (bun install --production), production stage (git + app source + USER bun)
- `.dockerignore` - Excludes node_modules, .git, tmp/, .planning/, *.md, .env*, Dockerfile, coverage, out, dist

## Decisions Made
- Alpine base image confirmed working -- agent-sdk manifest supports linux-x64-musl, build completed without issues
- No Claude CLI installation needed -- agent-sdk bundles cli.js (11MB JS bundle) resolved at runtime
- git installed as only additional Alpine package (required for workspace manager's git clone)
- USER bun for security (non-root) -- oven/bun images include this user, /tmp is world-writable for workspaces

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Docker image builds and passes all checks (non-root user, git available, production deps only)
- Ready for Plan 02: Azure Container Apps deployment, ACR push, secrets configuration, end-to-end verification
- Blocker: Azure Container Apps environment and GitHub App registration still needed for Plan 02

## Self-Check: PASSED

- FOUND: Dockerfile
- FOUND: .dockerignore
- FOUND: 08-01-SUMMARY.md
- FOUND: commit 808a215

---
*Phase: 08-deployment*
*Completed: 2026-02-08*

# Phase 8 Plan 2: Azure Container Apps Deployment Summary

**Azure Container Apps deployment with ACR, managed identity, secrets management, health probes, and verified end-to-end PR review and @mention flows**

## Performance

- **Duration:** ~15 min (including Azure provisioning wait times)
- **Started:** 2026-02-08T17:50:00Z
- **Completed:** 2026-02-08T18:33:00Z
- **Tasks:** 3 (1 auto + 2 checkpoints)
- **Files modified:** 2

## Accomplishments
- deploy.sh provisions all Azure resources: resource group, ACR, managed identity, Container Apps environment, container app with secrets and health probes
- Application deployed and running at https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
- Health endpoints verified: /health returns {"status":"ok"}, /readiness returns {"status":"ready"}
- End-to-end @kodiai mention tested: responded in 58s with $0.27 cost (13 turns)
- End-to-end PR auto-review tested: reviewed in 20s with $0.10 cost (6 turns)
- GitHub repo created and pushed: https://github.com/xbmc/kodiai (private)

## Task Commits

1. **Task 1: Create Azure deployment script** - `fbbab14` (feat)
2. **Bug fix: explicit refspec for base branch fetch** - `d5a4a33` (fix)
3. **Bug fix: include image and env vars in health probe YAML** - `478537e` (fix)

## Files Created/Modified
- `deploy.sh` - Azure Container Apps provisioning script (ACR, managed identity, secrets, health probes, external ingress)
- `src/handlers/review.ts` - Fixed base branch fetch to use explicit refspec for single-branch clones

## Decisions Made
- ACR remote build avoids needing Docker locally for deployment
- Managed identity for ACR pull auth (no admin credentials stored)
- min-replicas 1 keeps container always-on for webhook reception (~$5/month)
- Health probe YAML must include full container spec (image + env vars) since `az containerapp update --yaml` replaces the entire container definition
- Microsoft.ContainerRegistry provider registration required as a prerequisite

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Microsoft.ContainerRegistry provider not registered**
- **Found during:** Task 1 execution (deploy.sh run)
- **Issue:** Azure subscription didn't have ContainerRegistry provider registered, blocking ACR creation
- **Fix:** Ran `az provider register --namespace Microsoft.ContainerRegistry --wait` before ACR creation
- **Verification:** Provider registered, ACR created successfully

**2. [Rule 1 - Bug] Health probe YAML wiped env vars**
- **Found during:** Post-deployment verification
- **Issue:** `az containerapp update --yaml` with health probes replaced the container spec, removing all env vars and causing GITHUB_PRIVATE_KEY crash
- **Fix:** Added image and env vars to the YAML template; re-added env vars via `az containerapp update --set-env-vars`
- **Files modified:** deploy.sh
- **Committed in:** `478537e`

**3. [Rule 1 - Bug] Base branch fetch failed in single-branch clones**
- **Found during:** PR auto-review test (PR #2)
- **Issue:** `git fetch origin master --depth=1` didn't create `origin/master` tracking ref in single-branch clones, causing `git diff origin/master...HEAD` to fail
- **Fix:** Changed to explicit refspec: `git fetch origin master:refs/remotes/origin/master --depth=1`
- **Files modified:** src/handlers/review.ts
- **Committed in:** `d5a4a33`

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs)
**Impact on plan:** All fixes necessary for production operation. No scope creep.

## Issues Encountered
- Webhook signature verification initially failed due to secret mismatch timing (secret updated in GitHub before Azure container restarted)
- GitHub App was missing `pull_request` event subscription (had `pull_request_review` but not `pull_request`)
- Both resolved during deployment verification

## User Setup Required
None - deployment completed interactively during this session.

## Next Phase Readiness
- **Phase 8 complete.** All 8 phases of the kodiai milestone are done.
- Application is live and processing webhooks
- FQDN: ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
- GitHub App installed on kodiai/xbmc for testing
- GitHub repo: https://github.com/xbmc/kodiai (private)

---
*Phase: 08-deployment*
*Completed: 2026-02-08*

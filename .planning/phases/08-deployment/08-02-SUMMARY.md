---
phase: 08-deployment
plan: 02
subsystem: infra
tags: [azure, container-apps, acr, deployment, secrets, health-probes]

# Dependency graph
requires:
  - phase: 08-deployment
    provides: Dockerfile and .dockerignore for containerized Bun application
provides:
  - Azure Container Apps deployment script (deploy.sh)
  - Live production deployment at ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
  - Health probes (liveness, readiness, startup)
  - Secrets management via Azure secretref
affects: []

# Tech tracking
tech-stack:
  added: [azure-container-apps, azure-container-registry, managed-identity]
  patterns: [az-cli-provisioning, secretref-env-vars, yaml-health-probes, idempotent-deploy-script]

key-files:
  created:
    - deploy.sh
  modified:
    - src/handlers/review.ts

key-decisions:
  - "ACR remote build (az acr build) used instead of local docker build + push"
  - "Managed identity with AcrPull role for registry auth (no admin credentials)"
  - "min-replicas 1 to prevent webhook timeouts from cold starts"
  - "GITHUB_PRIVATE_KEY_BASE64 passed through Azure secrets; app's loadPrivateKey() handles base64 decoding"
  - "Health probe YAML must include image and env vars to avoid overwrite by az containerapp update"
  - "Microsoft.ContainerRegistry provider must be registered before ACR creation"
  - "Explicit git refspec needed for base branch fetch in single-branch clones"

patterns-established:
  - "Deploy via deploy.sh with 4 required env vars (GITHUB_APP_ID, GITHUB_PRIVATE_KEY_BASE64, GITHUB_WEBHOOK_SECRET, CLAUDE_CODE_OAUTH_TOKEN)"
  - "Redeploy: az acr build --registry kodiairegistry --image kodiai:vN . && az containerapp update --image kodiairegistry.azurecr.io/kodiai:vN"

# Metrics
duration: 15min
completed: 2026-02-08
---

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

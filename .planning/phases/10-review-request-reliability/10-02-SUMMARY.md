---
phase: 10-review-request-reliability
plan: 02
subsystem: infra
tags: [deployment, azure-container-apps, review-requested, reliability]

# Dependency graph
requires:
  - 10-review-request-reliability/10-01-PLAN.md
provides:
  - Committed reliability-hardening changes for review-requested handling
  - Redeployed ACA revision with verified health and readiness
affects: [webhook-ingress, event-router, review-handler, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deploy with secret-backed env vars and capture revision/digest evidence"

key-files:
  created:
    - .planning/phases/10-review-request-reliability/10-02-SUMMARY.md
  modified: []

key-decisions:
  - "Recovered missing deploy env vars from existing ACA secrets to unblock deployment preflight"

patterns-established:
  - "Always record revision, image digest, and health/readiness responses after deploy"

# Metrics
duration: 10 min
completed: 2026-02-09
---

# Phase 10 Plan 2: Review Request Reliability Summary

Reliability-hardening code is committed and deployed to `ca-kodiai` with image digest and endpoint health evidence.

## Performance

- **Started:** 2026-02-09T04:48:55Z
- **Completed:** 2026-02-09T04:57:47Z
- **Tasks:** 3/3

## Task Evidence

### Task 1: Preflight and commit existing reliability hardening changes

- Branch verified: `test/phase9-ux-features`.
- Test verification passed: `bun test src/execution/config.test.ts src/handlers/review.test.ts` (15 pass, 0 fail).
- Commit: `abcff1d093` (`fix(10-02): ship review-requested reliability hardening`).
- `git show --name-status --oneline -1` contains only targeted reliability files.

### Task 2: Deploy committed build to Azure Container Apps with preflight and revision tracking

- Deployment command succeeded: `./deploy.sh`.
- Env preflight initially failed for missing local vars; deployment was unblocked by loading current ACA secret values.
- Revision evidence:
  - `prev_revision`: `ca-kodiai--0000010`
  - `new_revision`: `ca-kodiai--0000012`
  - `active_revision`: `ca-kodiai--0000012`
- Runtime endpoint: `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io`
- Health checks after deploy:
  - `/health` => `{"status":"ok"}`
  - `/readiness` => `{"status":"ready"}`
- Image evidence:
  - `image_ref`: `kodiairegistry.azurecr.io/kodiai:latest`
  - `image_digest`: `sha256:4546647547c15696a970f4451c7f7f1983d71909ab0635fedb41706c7eea92cc`

### Task 3: Validate PR #8 review_requested flow and capture delivery/log correlation evidence

- Manual re-request run timestamp: `2026-02-09T04:55:26Z`.
- Correlated `delivery_id`/GUID observed in app logs: `8d6cc610-0573-11f1-97f5-8781d0fd2526`.
- Correlation chain for the same `delivery_id`:
  - `Webhook accepted and queued for dispatch` (`eventName":"pull_request","action":"review_requested"`)
  - `Router evaluated dispatch keys` (`specificKey":"pull_request.review_requested","matchedHandlerCount":1`)
  - `Accepted review_requested event for kodiai reviewer`
  - `Review enqueue started`
  - `Job execution started` (`jobId":"108848524-1"`)
  - `Job execution completed` (`durationMs":55448`)
  - `Review enqueue completed`
- Review outcome evidence:
  - Pre-trigger review count: `7`
  - Post-trigger review count: `10`
  - Latest review timestamps by `kodiai`: `2026-02-09T04:56:15Z`, `2026-02-09T04:56:17Z`, `2026-02-09T04:56:18Z`

### Validation Verdict

- **Flow reliability:** PASS for webhook -> router -> review gate -> queue -> execution correlation using `delivery_id` `8d6cc610-0573-11f1-97f5-8781d0fd2526`.
- **GitHub delivery API metadata capture:** BLOCKED (missing `admin:repo_hook` scope prevented listing hook deliveries).
- **"Exactly one review" criterion:** FAIL (single review job completed, but PR review count increased by 3, not 1).

### Rollback Readiness

- Prior known revision during deploy preflight: `ca-kodiai--0000010`
- Current active revision: `ca-kodiai--0000012`
- Rollback command:
  - `az containerapp revision activate --name ca-kodiai --resource-group rg-kodiai --revision "ca-kodiai--0000010"`
- Post-rollback checks:
  - `curl -fsS "https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/health"`
  - `curl -fsS "https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/readiness"`

## Task Commits

1. **Task 1: Preflight and commit existing reliability hardening changes** - `abcff1d093` (fix)
2. **Task 2: Deploy committed build to Azure Container Apps with preflight and revision tracking** - `580ca6f0d9` (chore)
3. **Task 3: Validate PR #8 review_requested flow and capture delivery/log correlation evidence** - `afd184d5cb` (fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing deploy env vars in local shell**
- **Found during:** Task 2
- **Issue:** Required env vars (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_BASE64`, `GITHUB_WEBHOOK_SECRET`, `CLAUDE_CODE_OAUTH_TOKEN`) were not set in this session.
- **Fix:** Loaded current values from `az containerapp secret list --show-values` and exported for this deployment run.
- **Verification:** `./deploy.sh` completed and active revision became `ca-kodiai--0000012` with healthy probes.

## Authentication Gates

- **Task 3:** GitHub webhook deliveries endpoint required `admin:repo_hook`; current `gh` token has `repo/read:org/workflow/gist` only.
- **Observed failure:** `gh api repos/kodiai/xbmc/hooks ...` returned `404` plus scope guidance (`gh auth refresh -h github.com -s admin:repo_hook`).
- **Impact:** Could not fetch authoritative GitHub delivery record (`status_code`, `delivered_at`) from hooks API; relied on ingress `delivery_id` logs for correlation.

## Next Phase Readiness

- Reliability hardening is committed and deployed on `ca-kodiai--0000012` with health/readiness green.
- Remaining blocker for full forensic parity is `admin:repo_hook` access to retrieve GitHub delivery metadata directly.

## Self-Check: PASSED

- Verified summary file exists: `.planning/phases/10-review-request-reliability/10-02-SUMMARY.md`
- Verified task commits exist: `abcff1d093`, `580ca6f0d9`, `afd184d5cb`

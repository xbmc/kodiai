---
phase: 01-webhook-foundation
plan: 02
subsystem: auth
tags: [github-app, jwt, octokit, auth-app, installation-token, readiness-probe]

# Dependency graph
requires:
  - phase: 01-webhook-foundation/01
    provides: "Hono server, config with githubAppId/githubPrivateKey, logger, route factory pattern"
provides:
  - "GitHub App JWT authentication via @octokit/auth-app"
  - "Installation access token minting via getInstallationOctokit(installationId)"
  - "App slug discovery at startup for bot self-filtering"
  - "Real readiness probe checking GitHub API connectivity with 30-second cache"
affects: [01-03-PLAN, 02-job-infrastructure, 04-pr-auto-review, 05-mention-handling]

# Tech tracking
tech-stack:
  added: []
  patterns: [app-level-octokit-singleton, per-call-installation-octokit, timestamp-cache-pattern]

key-files:
  created:
    - src/auth/github-app.ts
  modified:
    - src/index.ts
    - src/routes/health.ts
    - src/routes/webhooks.ts

key-decisions:
  - "Rely on @octokit/auth-app built-in token caching (up to 15K tokens, auto-refresh) -- no custom cache"
  - "Fresh Octokit instance per getInstallationOctokit() call to avoid stale state"
  - "Connectivity check uses simple timestamp + boolean cache (30s TTL) to avoid rate limiting"
  - "App-level Octokit is a singleton; installation-level Octokit is per-call"

patterns-established:
  - "GitHubApp service: factory function returning an interface with initialize/getInstallationOctokit/getAppSlug/checkConnectivity"
  - "Fail-fast startup: async initialize() must succeed before server starts"
  - "Timestamp-based result caching: lastCheckTime + lastCheckResult pattern for rate-limited endpoints"

# Metrics
duration: 3min
completed: 2026-02-08
---

# Phase 1 Plan 2: GitHub App Authentication Summary

**GitHub App JWT auth via @octokit/auth-app with installation token minting, app slug discovery at startup, and real readiness probe checking GitHub API connectivity**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-08T04:09:02Z
- **Completed:** 2026-02-08T04:11:55Z
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 3

## Accomplishments

- GitHub App auth module using @octokit/auth-app createAppAuth strategy (no hand-rolled JWT signing)
- Installation-scoped Octokit clients via getInstallationOctokit(installationId) with built-in token caching
- App slug fetched at startup via apps.getAuthenticated() for bot self-filtering in Plan 03
- Readiness probe upgraded from static 200 to real GitHub API connectivity check with 30-second cache
- Fail-fast server startup: crashes immediately if GitHub App credentials are invalid

## Task Commits

Each task was committed atomically:

1. **Task 1: GitHub App auth module with JWT, installation tokens, and app slug** - `0165a10` (feat)
2. **Task 2: Wire auth into server startup and readiness probe** - `ac47249` (feat)

## Files Created/Modified

- `src/auth/github-app.ts` - GitHubApp service: createGitHubApp factory with initialize, getInstallationOctokit, getAppSlug, checkConnectivity
- `src/index.ts` - Wire githubApp initialization before server start, pass to route factories
- `src/routes/health.ts` - Real readiness probe calling checkConnectivity(), 503 when unreachable
- `src/routes/webhooks.ts` - Added githubApp to WebhookRouteDeps (for Plan 03 bot filtering)

## Decisions Made

- Rely on @octokit/auth-app's built-in LRU cache for installation tokens (up to 15K entries, auto-refreshes before 1-hour expiry) -- no custom token cache needed
- Create fresh Octokit instance per getInstallationOctokit() call; the auth strategy handles token reuse transparently
- Connectivity check caches result for 30 seconds using simple timestamp comparison, avoiding rate limiting from frequent Azure readiness probes
- App-level Octokit is a singleton created once in createGitHubApp; installation-level Octokit is created per request

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**External services require manual configuration.** GitHub App credentials must be set as environment variables:

| Variable | Source |
|----------|--------|
| `GITHUB_APP_ID` | GitHub Settings > Developer settings > GitHub Apps > Your App > App ID |
| `GITHUB_PRIVATE_KEY` | GitHub Settings > Developer settings > GitHub Apps > Your App > Generate a private key (downloads .pem file) |
| `GITHUB_WEBHOOK_SECRET` | Set during GitHub App creation (Webhook secret field) |

These were already specified in `.env.example` from Plan 01. The server will crash at startup if any are missing or invalid.

## Next Phase Readiness

- GitHub App auth module is fully wired and ready for API calls
- Plan 03 can use `githubApp.getAppSlug()` for bot self-filtering
- Plan 03 can use `githubApp.getInstallationOctokit(installationId)` for API interactions
- The githubApp instance is already passed to WebhookRouteDeps, so Plan 03 only needs to destructure it

## Self-Check: PASSED

All 4 key files verified present. Both task commits (0165a10, ac47249) verified in git log.

---
*Phase: 01-webhook-foundation*
*Completed: 2026-02-08*

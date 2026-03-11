---
id: T02
parent: S01
milestone: M001
provides:
  - "GitHub App JWT authentication via @octokit/auth-app"
  - "Installation access token minting via getInstallationOctokit(installationId)"
  - "App slug discovery at startup for bot self-filtering"
  - "Real readiness probe checking GitHub API connectivity with 30-second cache"
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# T02: 01-webhook-foundation 02

**# Phase 1 Plan 2: GitHub App Authentication Summary**

## What Happened

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

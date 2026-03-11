# T02: 01-webhook-foundation 02

**Slice:** S01 — **Milestone:** M001

## Description

Implement GitHub App authentication -- JWT signing, installation access token management with caching, app slug discovery at startup, and a real readiness probe that checks GitHub API connectivity.

Purpose: The auth module is the bridge between receiving webhooks and acting on them. Without it, the server can verify signatures but cannot make API calls (post comments, fetch PRs, etc.). The app slug is also needed for bot self-filtering in Plan 03.
Output: A GitHubApp service with `getInstallationOctokit(installationId)` for repo-level API calls, `getAppSlug()` for self-filtering, `checkConnectivity()` for readiness probes, and a wired-up /readiness endpoint.

## Must-Haves

- [ ] "The server authenticates as a GitHub App using JWT signed with the private key"
- [ ] "Installation access tokens are minted per installation ID and cached in memory"
- [ ] "Cached tokens are refreshed before expiry (no stale token errors)"
- [ ] "GET /readiness checks GitHub API connectivity and returns 503 when unreachable"
- [ ] "The app slug is fetched at startup and available for bot self-filtering"

## Files

- `src/auth/github-app.ts`
- `src/routes/health.ts`
- `src/index.ts`

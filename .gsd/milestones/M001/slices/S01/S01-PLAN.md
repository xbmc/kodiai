# S01: Webhook Foundation

**Goal:** Initialize the Kodiai project, create the Hono HTTP server, implement webhook signature verification, delivery deduplication, health/readiness endpoints, and fail-fast configuration validation.
**Demo:** Initialize the Kodiai project, create the Hono HTTP server, implement webhook signature verification, delivery deduplication, health/readiness endpoints, and fail-fast configuration validation.

## Must-Haves


## Tasks

- [x] **T01: 01-webhook-foundation 01** `est:5min`
  - Initialize the Kodiai project, create the Hono HTTP server, implement webhook signature verification, delivery deduplication, health/readiness endpoints, and fail-fast configuration validation.

Purpose: Establish the foundation that all subsequent plans build on -- a running HTTP server that can receive GitHub webhooks, verify their authenticity, and reject invalid/duplicate requests.
Output: A working Bun + Hono server with POST /webhooks/github (signature verified, deduplicated), GET /health, GET /readiness endpoints, structured JSON logging via pino, and Zod-validated config that crashes on missing secrets.
- [x] **T02: 01-webhook-foundation 02** `est:3min`
  - Implement GitHub App authentication -- JWT signing, installation access token management with caching, app slug discovery at startup, and a real readiness probe that checks GitHub API connectivity.

Purpose: The auth module is the bridge between receiving webhooks and acting on them. Without it, the server can verify signatures but cannot make API calls (post comments, fetch PRs, etc.). The app slug is also needed for bot self-filtering in Plan 03.
Output: A GitHubApp service with `getInstallationOctokit(installationId)` for repo-level API calls, `getAppSlug()` for self-filtering, `checkConnectivity()` for readiness probes, and a wired-up /readiness endpoint.
- [x] **T03: 01-webhook-foundation 03** `est:3min`
  - Implement the event handler registry with explicit Map-based routing, bot filtering pipeline, and wire the complete webhook processing flow -- from signature verification through bot filtering to isolated handler dispatch.

Purpose: This completes the Phase 1 goal. After this plan, the webhook foundation is fully functional: events arrive, are verified, deduplicated, filtered for bots, and dispatched to registered handlers with isolated error handling. Phase 2+ handlers can simply register via the event router.
Output: A complete event routing system with `register(eventKey, handler)` and `dispatch(event)`, a bot filter that blocks bot accounts (except those on the allow-list) and always blocks self-events, and the full webhook processing pipeline wired end-to-end.

## Files Likely Touched

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `src/config.ts`
- `src/lib/logger.ts`
- `src/routes/webhooks.ts`
- `src/routes/health.ts`
- `src/webhook/verify.ts`
- `src/webhook/dedup.ts`
- `src/webhook/types.ts`
- `.env.example`
- `src/auth/github-app.ts`
- `src/routes/health.ts`
- `src/index.ts`
- `src/webhook/router.ts`
- `src/webhook/filters.ts`
- `src/webhook/types.ts`
- `src/routes/webhooks.ts`
- `src/index.ts`

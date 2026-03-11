---
id: S01
parent: M001
milestone: M001
provides:
  - "Event handler registry with Map-based dispatch by event type + action"
  - "Bot filtering pipeline: self-event filtering (always) + configurable allow-list"
  - "Isolated handler dispatch via Promise.allSettled"
  - "Complete webhook processing pipeline: receive -> verify -> dedup -> parse -> filter -> dispatch"
  - "eventRouter.register() API for Phase 2+ handler registration"
  - "Hono HTTP server on Bun with POST /webhooks/github"
  - "HMAC-SHA256 webhook signature verification via @octokit/webhooks-methods"
  - "Delivery ID deduplication (Map-based with 24h cleanup)"
  - "GET /health and GET /readiness endpoints"
  - "Fail-fast Zod-validated config (crashes on missing secrets)"
  - "pino structured JSON logger factory"
  - "Shared webhook types (WebhookEvent, EventHandler, AppConfig)"
  - "GitHub App JWT authentication via @octokit/auth-app"
  - "Installation access token minting via getInstallationOctokit(installationId)"
  - "App slug discovery at startup for bot self-filtering"
  - "Real readiness probe checking GitHub API connectivity with 30-second cache"
requires: []
affects: []
key_files: []
key_decisions:
  - "Bot filter takes logger as parameter for debug-level filter logging"
  - "Event router supports both 'event.action' and 'event' keys firing for the same event (handlers from both collected)"
  - "No wildcard handler support -- unhandled events silently dropped per user decision"
  - "installationId defaults to 0 when payload has no installation field"
  - "Zod v4 used (installed as latest); API is backward-compatible with v3 patterns"
  - "loadConfig() is async to support file-based private key loading via Bun.file().text()"
  - "Deduplicator uses insert-count-based cleanup (every 1000 inserts) not timer-based"
  - "Webhook route returns JSON { received: true } on success, empty text on 401"
  - "Child loggers carry deliveryId and eventName context to avoid field duplication"
  - "Rely on @octokit/auth-app built-in token caching (up to 15K tokens, auto-refresh) -- no custom cache"
  - "Fresh Octokit instance per getInstallationOctokit() call to avoid stale state"
  - "Connectivity check uses simple timestamp + boolean cache (30s TTL) to avoid rate limiting"
  - "App-level Octokit is a singleton; installation-level Octokit is per-call"
patterns_established:
  - "Handler registration: eventRouter.register('event.action', handler) for specific or eventRouter.register('event', handler) for catch-all"
  - "Bot filter pipeline: normalize login (lowercase, strip [bot] suffix), check self, check type, check allow-list"
  - "Fire-and-fork: Promise.resolve().then(() => dispatch(event)).catch(log) without await for async processing"
  - "Factory functions: createLogger(), createDeduplicator(), createWebhookRoutes(deps), createHealthRoutes()"
  - "Dependency injection via deps object parameter for route factories"
  - "Fire-and-forget: Promise.resolve().then(() => process()).catch(err => log) pattern for async webhook processing"
  - "Raw body first: c.req.text() before JSON.parse() to preserve HMAC integrity"
  - "GitHubApp service: factory function returning an interface with initialize/getInstallationOctokit/getAppSlug/checkConnectivity"
  - "Fail-fast startup: async initialize() must succeed before server starts"
  - "Timestamp-based result caching: lastCheckTime + lastCheckResult pattern for rate-limited endpoints"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# S01: Webhook Foundation

**# Phase 1 Plan 3: Event Router and Bot Filtering Summary**

## What Happened

# Phase 1 Plan 3: Event Router and Bot Filtering Summary

**Map-based event router with Promise.allSettled isolated dispatch, bot filter pipeline with unconditional self-event filtering and configurable allow-list, wired end-to-end from webhook receipt to handler execution**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-08T04:15:34Z
- **Completed:** 2026-02-08T04:17:53Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 3

## Accomplishments

- Event router with Map-based handler registry supporting both "event.action" (specific) and "event" (catch-all) key formats
- Bot filter that always drops the app's own events and filters other bots unless on the configurable allow-list
- Handler error isolation via Promise.allSettled -- one handler failure cannot affect others
- Complete webhook pipeline wired end-to-end: HTTP POST -> signature verify -> dedup -> parse -> bot filter -> dispatch
- Fire-and-fork pattern returning 200 to GitHub before any handler execution begins
- Phase 1 webhook foundation is now fully complete -- Phase 2+ handlers simply call eventRouter.register()

## Task Commits

Each task was committed atomically:

1. **Task 1: Bot filter and event router implementation** - `bc6195a` (feat)
2. **Task 2: Wire complete webhook processing pipeline** - `a2d63b9` (feat)

## Files Created/Modified

- `src/webhook/router.ts` - Event router: createEventRouter factory with register() and dispatch() using Map-based handler registry
- `src/webhook/filters.ts` - Bot filter: createBotFilter factory with shouldProcess() checking self-events, sender type, and allow-list
- `src/webhook/types.ts` - Added BotFilter, EventRouter interfaces and installationId to WebhookEvent
- `src/routes/webhooks.ts` - Replaced placeholder processEvent stub with real eventRouter.dispatch() via fire-and-fork
- `src/index.ts` - Created botFilter and eventRouter, wired into webhook route deps

## Decisions Made

- Bot filter receives logger as a constructor parameter (not imported globally) -- follows established deps injection pattern
- Both "event.action" and "event" handlers fire for the same event -- enables both specific and catch-all registrations
- No wildcard "*" handler support added -- unhandled events silently dropped with debug logging per user decision about noise
- installationId defaults to 0 when payload lacks installation field (some webhook events like ping don't have it)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no additional external service configuration required beyond what Plans 01 and 02 established.

## Phase 1 Completion Status

All Phase 1 requirements are now satisfied:

| Requirement | Status | Verified By |
|-------------|--------|-------------|
| INFRA-01: POST /webhooks/github receives events | Done | Plan 01 |
| INFRA-02: HMAC-SHA256 signature verification | Done | Plan 01 |
| INFRA-03: GitHub App JWT auth + installation tokens | Done | Plan 02 |
| INFRA-04: Async event processing (acknowledge-then-process) | Done | Plan 03 fire-and-fork |
| INFRA-06: Bot filtering (self + bot accounts) | Done | Plan 03 bot filter |
| INFRA-07: Event router classifies and dispatches | Done | Plan 03 event router |
| INFRA-08: Health endpoint returns 200 | Done | Plan 01 |

## Next Phase Readiness

- Phase 2 (Job Infrastructure) can proceed immediately
- Handler registration API is ready: `eventRouter.register("pull_request.opened", handler)`
- Installation Octokit available via `githubApp.getInstallationOctokit(event.installationId)`
- No blockers for Phase 2 (job queue, workspace manager)

## Self-Check: PASSED

All 5 key files verified present. Both task commits (bc6195a, a2d63b9) verified in git log.

---
*Phase: 01-webhook-foundation*
*Completed: 2026-02-08*

# Phase 1 Plan 1: Project Init and Webhook Server Summary

**Bun + Hono HTTP server with HMAC-SHA256 webhook signature verification, delivery deduplication, fail-fast Zod config, and pino JSON logging**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-08T04:00:21Z
- **Completed:** 2026-02-08T04:05:44Z
- **Tasks:** 2
- **Files created:** 9
- **Files modified:** 2

## Accomplishments

- Bun project initialized with all production and dev dependencies (hono, octokit, pino, zod)
- Fail-fast config validation via Zod that crashes on missing GITHUB_APP_ID, GITHUB_PRIVATE_KEY, or GITHUB_WEBHOOK_SECRET
- Private key loading supports inline PEM, file path, and base64-encoded formats
- POST /webhooks/github verifies HMAC-SHA256 signatures using @octokit/webhooks-methods (timing-safe)
- Delivery ID deduplication detects and skips duplicate X-GitHub-Delivery values
- Fire-and-forget async processing returns 200 within milliseconds (avoids GitHub 10s timeout)
- GET /health and GET /readiness endpoints for liveness/readiness probes
- All application log output is structured JSON via pino (no pretty-print)

## Task Commits

Each task was committed atomically:

1. **Task 1: Project initialization, config, and logger** - `283af98` (feat)
2. **Task 2: HTTP server, webhook endpoint, signature verification, and dedup** - `6cea6cd` (feat)

## Files Created/Modified

- `package.json` - Project manifest with hono, octokit, pino, zod dependencies and dev/start scripts
- `tsconfig.json` - Strict TypeScript config for Bun with tmp/ excluded
- `src/index.ts` - Server entry point: loads config, creates app, mounts routes, exports Bun.serve config
- `src/config.ts` - Zod schema validation for env vars with fail-fast on missing secrets
- `src/lib/logger.ts` - pino logger factory and child logger creation for request context
- `src/routes/webhooks.ts` - POST /webhooks/github with signature verification, dedup, fire-and-forget processing
- `src/routes/health.ts` - GET /health (liveness) and GET /readiness (placeholder for Plan 02)
- `src/webhook/verify.ts` - HMAC-SHA256 signature verification wrapping @octokit/webhooks-methods
- `src/webhook/dedup.ts` - Delivery ID deduplication factory with Map-based storage and periodic cleanup
- `src/webhook/types.ts` - WebhookEvent, EventHandler, and AppConfig type exports
- `.env.example` - Documented environment variable template

## Decisions Made

- Used Zod v4 (latest) which maintains backward compatibility with v3 schema patterns
- Made loadConfig() async to support reading private key from file path via Bun.file().text()
- Deduplicator cleanup triggers every 1000 inserts (not timer-based) for simplicity
- Webhook responses use JSON body `{ received: true }` for success, empty text for 401

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed Bun runtime**
- **Found during:** Task 1 (project initialization)
- **Issue:** Bun was not installed on the system
- **Fix:** Installed via `curl -fsSL https://bun.sh/install | bash` (v1.3.8)
- **Files modified:** None (system-level install)
- **Verification:** `bun --version` returns 1.3.8

**2. [Rule 3 - Blocking] Excluded tmp/ from TypeScript compilation**
- **Found during:** Task 1 (TypeScript verification)
- **Issue:** `bunx tsc --noEmit` failed with 55+ errors from reference code in tmp/ directory
- **Fix:** Added `"include": ["src/**/*.ts"]` and `"exclude": ["tmp", "node_modules"]` to tsconfig.json
- **Files modified:** tsconfig.json
- **Verification:** `bunx tsc --noEmit` passes with zero errors
- **Committed in:** 283af98 (Task 1 commit)

**3. [Rule 1 - Bug] Fixed duplicate log fields in child logger**
- **Found during:** Task 2 (log verification)
- **Issue:** processEvent() was logging deliveryId and eventName explicitly while the child logger already carried those fields in its context, resulting in duplicate JSON fields
- **Fix:** Removed redundant deliveryId and eventName parameters from processEvent(), relying on child logger context
- **Files modified:** src/routes/webhooks.ts
- **Verification:** Log output shows each field exactly once
- **Committed in:** 6cea6cd (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All fixes necessary for correctness and build success. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Server is running and accepting webhook POSTs with signature verification
- Plan 02 (GitHub App authentication) can build on this: wire JWT auth, installation tokens, and real readiness probe
- Plan 03 (event routing) can replace the placeholder processEvent() with the handler registry
- The `processEvent` stub in webhooks.ts is clearly marked for replacement

## Self-Check: PASSED

All 12 files verified present. Both task commits (283af98, 6cea6cd) verified in git log.

---
*Phase: 01-webhook-foundation*
*Completed: 2026-02-08*

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

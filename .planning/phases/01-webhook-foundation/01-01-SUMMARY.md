---
phase: 01-webhook-foundation
plan: 01
subsystem: api
tags: [hono, bun, webhook, hmac-sha256, pino, zod, dedup]

# Dependency graph
requires: []
provides:
  - "Hono HTTP server on Bun with POST /webhooks/github"
  - "HMAC-SHA256 webhook signature verification via @octokit/webhooks-methods"
  - "Delivery ID deduplication (Map-based with 24h cleanup)"
  - "GET /health and GET /readiness endpoints"
  - "Fail-fast Zod-validated config (crashes on missing secrets)"
  - "pino structured JSON logger factory"
  - "Shared webhook types (WebhookEvent, EventHandler, AppConfig)"
affects: [01-02-PLAN, 01-03-PLAN, 02-job-infrastructure]

# Tech tracking
tech-stack:
  added: [bun@1.3.8, hono@4.11.8, pino@10.3.0, zod@4.3.6, "@octokit/webhooks-methods@6.0.0", "@octokit/auth-app@8.2.0", "@octokit/rest@22.0.1"]
  patterns: [factory-functions, dependency-injection, fire-and-forget-async, fail-fast-config]

key-files:
  created:
    - src/index.ts
    - src/config.ts
    - src/lib/logger.ts
    - src/routes/webhooks.ts
    - src/routes/health.ts
    - src/webhook/verify.ts
    - src/webhook/dedup.ts
    - src/webhook/types.ts
    - .env.example
  modified:
    - package.json
    - tsconfig.json

key-decisions:
  - "Zod v4 used (installed as latest); API is backward-compatible with v3 patterns"
  - "loadConfig() is async to support file-based private key loading via Bun.file().text()"
  - "Deduplicator uses insert-count-based cleanup (every 1000 inserts) not timer-based"
  - "Webhook route returns JSON { received: true } on success, empty text on 401"
  - "Child loggers carry deliveryId and eventName context to avoid field duplication"

patterns-established:
  - "Factory functions: createLogger(), createDeduplicator(), createWebhookRoutes(deps), createHealthRoutes()"
  - "Dependency injection via deps object parameter for route factories"
  - "Fire-and-forget: Promise.resolve().then(() => process()).catch(err => log) pattern for async webhook processing"
  - "Raw body first: c.req.text() before JSON.parse() to preserve HMAC integrity"

# Metrics
duration: 5min
completed: 2026-02-08
---

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

---
phase: 01-webhook-foundation
plan: 03
subsystem: webhook
tags: [event-router, bot-filter, dispatch, promise-allsettled, fire-and-fork]

# Dependency graph
requires:
  - phase: 01-webhook-foundation/01
    provides: "Hono server, webhook endpoint, signature verification, deduplication, logger"
  - phase: 01-webhook-foundation/02
    provides: "GitHub App auth with getAppSlug() for self-event filtering"
provides:
  - "Event handler registry with Map-based dispatch by event type + action"
  - "Bot filtering pipeline: self-event filtering (always) + configurable allow-list"
  - "Isolated handler dispatch via Promise.allSettled"
  - "Complete webhook processing pipeline: receive -> verify -> dedup -> parse -> filter -> dispatch"
  - "eventRouter.register() API for Phase 2+ handler registration"
affects: [02-job-infrastructure, 04-pr-auto-review, 05-mention-handling]

# Tech tracking
tech-stack:
  added: []
  patterns: [map-based-handler-registry, bot-filter-pipeline, fire-and-fork-dispatch, promise-allsettled-isolation]

key-files:
  created:
    - src/webhook/router.ts
    - src/webhook/filters.ts
  modified:
    - src/webhook/types.ts
    - src/routes/webhooks.ts
    - src/index.ts

key-decisions:
  - "Bot filter takes logger as parameter for debug-level filter logging"
  - "Event router supports both 'event.action' and 'event' keys firing for the same event (handlers from both collected)"
  - "No wildcard handler support -- unhandled events silently dropped per user decision"
  - "installationId defaults to 0 when payload has no installation field"

patterns-established:
  - "Handler registration: eventRouter.register('event.action', handler) for specific or eventRouter.register('event', handler) for catch-all"
  - "Bot filter pipeline: normalize login (lowercase, strip [bot] suffix), check self, check type, check allow-list"
  - "Fire-and-fork: Promise.resolve().then(() => dispatch(event)).catch(log) without await for async processing"

# Metrics
duration: 3min
completed: 2026-02-08
---

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

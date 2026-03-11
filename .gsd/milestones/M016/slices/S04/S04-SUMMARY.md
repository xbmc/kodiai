---
id: S04
parent: M016
milestone: M016
provides:
  - "Generic InMemoryCache<K,V> utility with configurable TTL and maxSize"
  - "Bounded ThreadSessionStore, WriteConfirmationStore, Deduplicator, and Slack installation cache"
  - Config-driven default repo via SLACK_DEFAULT_REPO env var
  - Structured logging in enforcement tooling detection
  - Typed GitHub Advisory/Release/Content API interfaces
  - Optimized telemetry purge without RETURNING clause
  - Slack client request timeout (10s default)
  - Per-channel sliding window rate limiter on Slack events
requires: []
affects: []
key_files: []
key_decisions:
  - "Lazy eviction only (no timers/intervals) -- evict expired on access and insert"
  - "Map insertion order as LRU proxy -- oldest entries evicted first when over maxSize"
  - "WriteConfirmationStore TTL set to 15min matching domain confirmation timeout"
  - "Tooling detection logger parameter is optional to maintain backward compatibility with existing callers and tests"
  - "defaultRepo is a required dep in SlackAssistantHandlerDeps rather than optional, forcing explicit configuration"
  - "Rate limiter uses inline Map rather than external dependency for simplicity"
patterns_established:
  - "InMemoryCache pattern: all in-process caches use createInMemoryCache with explicit maxSize and ttlMs"
  - "Injectable clock: pass now() for deterministic testing of time-dependent behavior"
  - "Config-driven defaults: Move hardcoded values to config.ts with env var backing and sensible defaults"
observability_surfaces: []
drill_down_paths: []
duration: 6min
verification_result: passed
completed_at: 2026-02-20
blocker_discovered: false
---
# S04: Code Review Fixes Memory Leaks Hardcoded Defaults Type Mismatches And Missing Rate Limits

**# Phase 85 Plan 01: Memory Leak Fixes Summary**

## What Happened

# Phase 85 Plan 01: Memory Leak Fixes Summary

**Shared InMemoryCache utility with TTL and LRU maxSize eviction, eliminating 4 unbounded memory leak vectors (C-2, C-3, H-1, H-3)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-20T03:29:30Z
- **Completed:** 2026-02-20T03:34:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created generic `InMemoryCache<K,V>` with configurable TTL expiry and maxSize eviction
- Migrated ThreadSessionStore from unbounded Set to InMemoryCache (10k max, 24h TTL)
- Migrated WriteConfirmationStore from unbounded Map to InMemoryCache (1k max, 15min TTL)
- Migrated Deduplicator from Map with manual cleanup to InMemoryCache (50k max, 24h TTL)
- Migrated Slack installation cache from unbounded Map to InMemoryCache (500 max, 1h TTL)
- All existing tests pass with no regressions from our changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create InMemoryCache utility with TTL and maxSize** - `ae0fa88a30` (feat)
2. **Task 2: Migrate stores to InMemoryCache** - `84d29615ee` (fix)

## Files Created/Modified
- `src/lib/in-memory-cache.ts` - Generic cache with TTL expiry and LRU-style maxSize eviction
- `src/lib/in-memory-cache.test.ts` - Tests for TTL, maxSize, expiry, clear, size, re-set refresh
- `src/slack/thread-session-store.ts` - Replaced Set with InMemoryCache (C-2 fix)
- `src/slack/write-confirmation-store.ts` - Replaced Map with InMemoryCache (C-3 fix)
- `src/slack/write-confirmation-store.test.ts` - Updated test for TTL-based expiry behavior
- `src/webhook/dedup.ts` - Replaced Map with InMemoryCache, removed manual cleanup (H-1 fix)
- `src/index.ts` - Replaced installation cache Map with InMemoryCache (H-3 fix)

## Decisions Made
- Used lazy eviction (no timers/intervals) to keep implementation simple and avoid background work
- Map insertion order serves as LRU proxy -- oldest entries evicted first when cache is full
- WriteConfirmationStore test updated to verify TTL expiry behavior (entries now properly evicted after TTL)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated write-confirmation-store test for TTL behavior**
- **Found during:** Task 2 (store migration)
- **Issue:** Existing test advanced clock 20min past a 15min TTL and expected entry to still be retrievable. With InMemoryCache, expired entries correctly return undefined.
- **Fix:** Split assertion into two: entry retrievable within TTL (14min), entry evicted after TTL (16min)
- **Files modified:** src/slack/write-confirmation-store.test.ts
- **Verification:** All write-confirmation-store tests pass
- **Committed in:** 84d29615ee (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test updated to match intentional new behavior. No scope creep.

## Issues Encountered
- Pre-existing test failures in assistant-handler.test.ts (10 tests) and repo-context.test.ts (2 tests) caused by uncommitted changes to repo-context.ts and assistant-handler.ts on the branch. These are unrelated to this plan's changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- InMemoryCache utility ready for use by any future in-memory store
- All 4 memory leak vectors addressed; remaining code review findings in Plan 02

---
*Phase: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits*
*Completed: 2026-02-20*

# Phase 85 Plan 02: Hardcoded Defaults, Type Safety, Telemetry Purge, Slack Timeout, and Rate Limiting Summary

**Config-driven default repo, typed Octokit calls, efficient telemetry purge, 10s Slack timeout, and per-channel rate limiting (30/60s)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-20T03:29:29Z
- **Completed:** 2026-02-20T03:35:29Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Removed hardcoded DEFAULT_REPO constant; default repo now configurable via SLACK_DEFAULT_REPO env var (C-1)
- Replaced console.warn with structured logger in tooling detection (H-4)
- Added typed interfaces for GitHub Advisory, Release, and Content API responses, eliminating most `as any` casts (H-5)
- Optimized telemetry purge to use DELETE + changes() instead of RETURNING id (H-8)
- Added configurable request timeout (10s default) to all Slack client fetch calls (M-2)
- Added per-channel sliding window rate limiter (30 events / 60 seconds) on Slack event processing (H-10)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix hardcoded default repo and structured logging** - `f3d26f205e` (fix)
2. **Task 2: Fix type safety, telemetry purge, Slack timeout, and rate limiting** - `371036c4f0` (fix)

## Files Created/Modified
- `src/config.ts` - Added slackDefaultRepo config field with SLACK_DEFAULT_REPO env var
- `src/slack/repo-context.ts` - Accepts defaultRepo parameter instead of hardcoded constant
- `src/slack/repo-context.test.ts` - Updated tests to pass defaultRepo, added custom default tests
- `src/enforcement/tooling-detection.ts` - Optional logger parameter, structured logging
- `src/enforcement/index.ts` - Passes logger to detectRepoTooling
- `src/slack/assistant-handler.ts` - Accepts and uses defaultRepo from deps
- `src/slack/assistant-handler.test.ts` - Updated all handler creations with defaultRepo
- `src/index.ts` - Passes config.slackDefaultRepo to assistant handler
- `src/lib/dep-bump-enrichment.ts` - Typed GitHub API responses, reduced `as any` casts
- `src/telemetry/store.ts` - Purge uses DELETE + changes() instead of RETURNING
- `src/slack/client.ts` - Added timeoutMs option with AbortSignal.timeout on all fetch calls
- `src/routes/slack-events.ts` - Per-channel sliding window rate limiter

## Decisions Made
- Tooling detection logger is optional to avoid breaking existing callers and tests that don't provide one
- defaultRepo is required in handler deps to force explicit configuration at the wiring point
- Rate limiter is inline (Map-based) rather than external library for simplicity and zero dependencies
- buildInstantReply updated to use defaultRepo instead of hardcoded "xbmc/xbmc" in ping response

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated buildInstantReply and instant reply result**
- **Found during:** Task 1 (Fix hardcoded default repo)
- **Issue:** buildInstantReply function and its caller hardcoded "xbmc/xbmc" in the ping response text and result
- **Fix:** Added defaultRepo parameter to buildInstantReply, updated caller to use defaultRepo in both response text and result object
- **Files modified:** src/slack/assistant-handler.ts
- **Verification:** All assistant-handler tests pass
- **Committed in:** f3d26f205e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for complete hardcoded default removal. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. SLACK_DEFAULT_REPO env var defaults to "xbmc/xbmc" if not set.

## Next Phase Readiness
- All 6 code review findings addressed (C-1, H-4, H-5, H-8, H-10, M-2)
- Full test suite passes (1112 tests, 0 failures)
- Ready for production deployment

---
*Phase: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits*
*Completed: 2026-02-20*

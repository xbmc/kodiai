---
phase: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits
plan: 01
subsystem: infra
tags: [memory-management, cache, ttl, lru, in-memory]

requires: []
provides:
  - "Generic InMemoryCache<K,V> utility with configurable TTL and maxSize"
  - "Bounded ThreadSessionStore, WriteConfirmationStore, Deduplicator, and Slack installation cache"
affects: [any future in-memory stores should use createInMemoryCache]

tech-stack:
  added: []
  patterns: [lazy-eviction-on-access, factory-function-with-injectable-clock]

key-files:
  created:
    - src/lib/in-memory-cache.ts
    - src/lib/in-memory-cache.test.ts
  modified:
    - src/slack/thread-session-store.ts
    - src/slack/write-confirmation-store.ts
    - src/slack/write-confirmation-store.test.ts
    - src/webhook/dedup.ts
    - src/index.ts

key-decisions:
  - "Lazy eviction only (no timers/intervals) -- evict expired on access and insert"
  - "Map insertion order as LRU proxy -- oldest entries evicted first when over maxSize"
  - "WriteConfirmationStore TTL set to 15min matching domain confirmation timeout"

patterns-established:
  - "InMemoryCache pattern: all in-process caches use createInMemoryCache with explicit maxSize and ttlMs"
  - "Injectable clock: pass now() for deterministic testing of time-dependent behavior"

requirements-completed: []

duration: 4min
completed: 2026-02-20
---

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

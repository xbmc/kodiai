---
phase: 66-search-cache-foundation
plan: 01
subsystem: api
tags: [search-api, caching, ttl, deduplication, testing]
requires:
  - phase: 65-02
    provides: Stable issue write-mode resilience and regression-testing patterns
provides:
  - Deterministic repository-scoped search cache key builder for semantic query equivalence
  - In-memory TTL cache primitive with concurrent in-flight loader coalescing
  - Fail-open cache behavior that never blocks upstream loader execution on cache faults
affects: [review-handler, retrieval, search-api-rate-limits]
tech-stack:
  added: []
  patterns:
    - Normalize search semantics (repo, searchType, query, extra) into stable JSON cache keys
    - Coalesce concurrent identical cache misses through a shared in-flight Promise map
    - Treat cache-layer faults as non-fatal and continue via loader path
key-files:
  created:
    - src/lib/search-cache.ts
    - src/lib/search-cache.test.ts
  modified:
    - src/lib/search-cache.ts
key-decisions:
  - "Cache keys serialize normalized repo/searchType/query plus recursively sorted extra semantic fields for deterministic equivalence."
  - "Cache internals fail open: map operation errors are reported via onError and never thrown into caller flows."
patterns-established:
  - "Search cache contract pattern: deterministic keying + bounded TTL + in-flight de-duplication + fail-open fallback."
duration: 1m43s
completed: 2026-02-16
---

# Phase 66 Plan 01: Search Cache Foundation Summary

**Deterministic search caching now reuses equivalent repository-scoped Search API queries within TTL windows, coalesces concurrent misses, and safely bypasses cache faults without breaking upstream loaders.**

## Performance

- **Duration:** 1m43s
- **Started:** 2026-02-16T23:43:42Z
- **Completed:** 2026-02-16T23:45:25Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `buildSearchCacheKey` to normalize query semantics and produce deterministic repo-scoped keys.
- Added `createSearchCache` with configurable TTL, injectable clock/store dependencies, and in-flight promise reuse.
- Added regression tests for key determinism, repo isolation, TTL expiry boundaries, concurrent coalescing, and fail-open cache errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build deterministic repo-scoped search cache module** - `ddac31769a` (feat)
2. **Task 2: Add exhaustive cache behavior regressions** - `771c4e8f63` (fix)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified
- `src/lib/search-cache.ts` - Search cache primitive with deterministic keys, TTL eviction, in-flight de-dupe, and fail-open behavior.
- `src/lib/search-cache.test.ts` - Unit regressions locking cache-key semantics, repository isolation, TTL behavior, and fault-tolerant coalescing.

## Decisions Made
- Deterministic keying lowercases and trims repository/search type and collapses query whitespace so semantically identical requests share cache entries.
- Cache internals report bookkeeping failures through `onError` while preserving loader execution and error propagation from the loader itself.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected `getOrLoad` to return the shared in-flight Promise instance**
- **Found during:** Task 2 (Add exhaustive cache behavior regressions)
- **Issue:** `getOrLoad` was `async`, so concurrent callers received wrapper Promises instead of the same in-flight Promise object.
- **Fix:** Converted `getOrLoad` to return `Promise<T>` directly and return `Promise.resolve` on cache hits.
- **Files modified:** `src/lib/search-cache.ts`
- **Verification:** `bun test src/lib/search-cache.test.ts --timeout 30000` and `bunx tsc --noEmit`
- **Committed in:** `771c4e8f63` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix was required to satisfy explicit in-flight coalescing behavior; no scope creep.

## Issues Encountered
- Initial coalescing assertion exposed Promise identity mismatch; adjusted implementation and re-ran verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Search cache foundation contracts are now locked with deterministic tests and can be integrated into handler retrieval paths.
- Ready for phase 66-02 integration work against Search API request flow.

## Self-Check: PASSED
- FOUND: `.planning/phases/66-search-cache-foundation/66-01-SUMMARY.md`
- FOUND: `ddac31769a`
- FOUND: `771c4e8f63`

## Auth Gates

None.

---
*Phase: 66-search-cache-foundation*
*Completed: 2026-02-16*

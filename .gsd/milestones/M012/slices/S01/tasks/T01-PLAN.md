# T01: 66-search-cache-foundation 01

**Slice:** S01 — **Milestone:** M012

## Description

Create a deterministic, repository-scoped Search API cache primitive that supports bounded TTL and concurrent request de-duplication.

Purpose: Satisfy OPS-01 foundation requirements before handler integration by locking key semantics, fail-open behavior, and race-safe in-flight reuse in one reusable module.
Output: New `src/lib/search-cache.ts` module and focused unit tests proving key normalization, repo isolation, bounded TTL eviction, and in-flight request coalescing.

## Must-Haves

- [ ] "Equivalent Search API requests within a bounded window return cached results instead of reissuing remote calls"
- [ ] "Cache keys are deterministic for repository + query semantics so equivalent requests map to one cache entry"
- [ ] "Cache lookups and writes fail open: internal cache errors do not throw into caller flows"

## Files

- `src/lib/search-cache.ts`
- `src/lib/search-cache.test.ts`

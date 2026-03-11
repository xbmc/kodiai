# S01: Search Cache Foundation

**Goal:** Create a deterministic, repository-scoped Search API cache primitive that supports bounded TTL and concurrent request de-duplication.
**Demo:** Create a deterministic, repository-scoped Search API cache primitive that supports bounded TTL and concurrent request de-duplication.

## Must-Haves


## Tasks

- [x] **T01: 66-search-cache-foundation 01** `est:1m43s`
  - Create a deterministic, repository-scoped Search API cache primitive that supports bounded TTL and concurrent request de-duplication.

Purpose: Satisfy OPS-01 foundation requirements before handler integration by locking key semantics, fail-open behavior, and race-safe in-flight reuse in one reusable module.
Output: New `src/lib/search-cache.ts` module and focused unit tests proving key normalization, repo isolation, bounded TTL eviction, and in-flight request coalescing.
- [x] **T02: 66-search-cache-foundation 02** `est:3m23s`
  - Wire the Phase 66 cache primitive into review enrichment so Search API usage is reduced through deterministic reuse and concurrent request coalescing.

Purpose: Complete OPS-01 for real execution paths by applying cache controls where GitHub Search is currently called, while preserving non-blocking fail-open behavior.
Output: Review handler integration with cache-backed author PR-count lookup plus regression tests for cache hit, in-flight de-dupe, and cache-fault fallback.

## Files Likely Touched

- `src/lib/search-cache.ts`
- `src/lib/search-cache.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

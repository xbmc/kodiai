# T02: 66-search-cache-foundation 02

**Slice:** S01 — **Milestone:** M012

## Description

Wire the Phase 66 cache primitive into review enrichment so Search API usage is reduced through deterministic reuse and concurrent request coalescing.

Purpose: Complete OPS-01 for real execution paths by applying cache controls where GitHub Search is currently called, while preserving non-blocking fail-open behavior.
Output: Review handler integration with cache-backed author PR-count lookup plus regression tests for cache hit, in-flight de-dupe, and cache-fault fallback.

## Must-Haves

- [ ] "Equivalent author-history Search API lookups in review enrichment reuse cached results within TTL"
- [ ] "Concurrent review enrichments that request the same repo/query semantics trigger at most one remote Search API request"
- [ ] "Search cache lookup/storage failures do not block review completion; handler continues with fail-open behavior"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

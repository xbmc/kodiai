# S06: Search Cache Telemetry Wiring Fix

**Goal:** Close OPS-03 blocker gaps by rewiring cache-hit telemetry to the actual Search API cache behavior from author-tier enrichment.
**Demo:** Close OPS-03 blocker gaps by rewiring cache-hit telemetry to the actual Search API cache behavior from author-tier enrichment.

## Must-Haves


## Tasks

- [x] **T01: 71-search-cache-telemetry-wiring-fix 01** `est:1m`
  - Close OPS-03 blocker gaps by rewiring cache-hit telemetry to the actual Search API cache behavior from author-tier enrichment.

Purpose: The v0.12 audit found Phase 67 telemetry using author classification cache flags instead of Phase 66 Search cache outcomes, making operator cache metrics incorrect for rate-limit tuning.
Output: Deterministic telemetry wiring where cacheHitRate is produced from Search cache hit/miss outcomes, plus regression tests that lock the wiring against future drift.

## Files Likely Touched

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

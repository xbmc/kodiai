# T01: 71-search-cache-telemetry-wiring-fix 01

**Slice:** S06 — **Milestone:** M012

## Description

Close OPS-03 blocker gaps by rewiring cache-hit telemetry to the actual Search API cache behavior from author-tier enrichment.

Purpose: The v0.12 audit found Phase 67 telemetry using author classification cache flags instead of Phase 66 Search cache outcomes, making operator cache metrics incorrect for rate-limit tuning.
Output: Deterministic telemetry wiring where cacheHitRate is produced from Search cache hit/miss outcomes, plus regression tests that lock the wiring against future drift.

## Must-Haves

- [ ] "Rate-limit telemetry cacheHitRate reflects Search API cache hit/miss outcomes from author-tier enrichment, not author classification cache state"
- [ ] "Phase 66 Search cache signals are propagated into Phase 67 telemetry writes with deterministic semantics across miss, hit, and fail-open fallback paths"
- [ ] "Regression tests fail if telemetry wiring is reverted to non-Search cache signals"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

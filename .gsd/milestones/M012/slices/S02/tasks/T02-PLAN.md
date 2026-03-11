# T02: 67-rate-limit-resilience-telemetry 02

**Slice:** S02 — **Milestone:** M012

## Description

Add production-facing telemetry for Search rate-limit handling so operators can measure cache effectiveness, retry behavior, and degraded execution paths.

Purpose: Deliver OPS-03 observability by persisting actionable metrics for cache hit rate, skipped queries, retry attempts, and degradation outcomes.
Output: Telemetry schema/store extensions and review-handler wiring with regression coverage for normal and degraded execution paths.

## Must-Haves

- [ ] "Telemetry records cache-hit usage, skipped queries, retry attempts, and degradation path whenever Search enrichment runs"
- [ ] "Rate-limit telemetry writes are additive-only and non-blocking, preserving fail-open execution behavior"
- [ ] "Operators can query production telemetry to validate rate-limit handling effectiveness under load"

## Files

- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

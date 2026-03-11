# S02: Rate Limit Resilience Telemetry

**Goal:** Add Search API rate-limit resilience so review enrichment performs a single bounded retry, then fails open into a clearly communicated partial-analysis path.
**Demo:** Add Search API rate-limit resilience so review enrichment performs a single bounded retry, then fails open into a clearly communicated partial-analysis path.

## Must-Haves


## Tasks

- [x] **T01: 67-rate-limit-resilience-telemetry 01** `est:3m29s`
  - Add Search API rate-limit resilience so review enrichment performs a single bounded retry, then fails open into a clearly communicated partial-analysis path.

Purpose: Deliver OPS-02 behavior in the live review flow by preventing hard failures during Search API throttling while making degraded outcomes explicit to users.
Output: Updated review handler and review prompt contracts with deterministic regressions for bounded retry and degraded messaging.
- [x] **T02: 67-rate-limit-resilience-telemetry 02** `est:3m14s`
  - Add production-facing telemetry for Search rate-limit handling so operators can measure cache effectiveness, retry behavior, and degraded execution paths.

Purpose: Deliver OPS-03 observability by persisting actionable metrics for cache hit rate, skipped queries, retry attempts, and degradation outcomes.
Output: Telemetry schema/store extensions and review-handler wiring with regression coverage for normal and degraded execution paths.

## Files Likely Touched

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

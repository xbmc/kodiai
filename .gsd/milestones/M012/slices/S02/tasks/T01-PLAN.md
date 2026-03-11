# T01: 67-rate-limit-resilience-telemetry 01

**Slice:** S02 — **Milestone:** M012

## Description

Add Search API rate-limit resilience so review enrichment performs a single bounded retry, then fails open into a clearly communicated partial-analysis path.

Purpose: Deliver OPS-02 behavior in the live review flow by preventing hard failures during Search API throttling while making degraded outcomes explicit to users.
Output: Updated review handler and review prompt contracts with deterministic regressions for bounded retry and degraded messaging.

## Must-Haves

- [ ] "When GitHub Search API responds with a rate-limit error, review enrichment retries exactly once with bounded backoff"
- [ ] "If retry still fails due to rate limits, review execution continues in degraded mode instead of failing hard"
- [ ] "Published review output clearly states that analysis is partial due to Search API limits when degradation occurs"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`

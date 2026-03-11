# T02: 56-foundation-layer 02

**Slice:** S01 — **Milestone:** M010

## Description

Extend the telemetry SQLite store and wire retrieval-quality logging after retrieval context generation (RET-05).

Purpose: Phase 56 needs low-risk observability for retrieval behavior to support later adaptive thresholds and tuning.
Output: New telemetry table + insert API, and review handler wiring that records result count, avg adjusted distance, threshold used, and language match ratio.

## Must-Haves

- [ ] "After reviews that attempt retrieval, a retrieval quality row is written to the telemetry DB"
- [ ] "Retrieval quality logging is fail-open and never blocks reviews"
- [ ] "Distance metrics reflect the reranked (adjusted) distances, not raw distances"
- [ ] "Schema migration is additive-only (new table + indexes only)"

## Files

- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

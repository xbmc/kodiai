# T01: 68-multi-query-retrieval-core 01

**Slice:** S03 — **Milestone:** M012

## Description

Build the RET-07 algorithmic core with TDD: deterministic multi-query expansion plus deterministic merged ranking behavior.

Purpose: Phase 68 depends on predictable retrieval behavior under retries, cache reuse, and fail-open error handling. A pure-function TDD module isolates that logic and locks correctness before pipeline wiring.
Output: `src/learning/multi-query-retrieval.ts` and `src/learning/multi-query-retrieval.test.ts` with RED->GREEN coverage for variant generation, stable ordering, and error isolation.

## Must-Haves

- [ ] "Given one request context, retrieval query expansion emits bounded intent, file-path, and code-shape variants"
- [ ] "Deterministic merge/rerank returns stable ordering for equivalent inputs across runs"
- [ ] "Variant-level failures are isolated so successful variants still produce merged output"

## Files

- `src/learning/multi-query-retrieval.ts`
- `src/learning/multi-query-retrieval.test.ts`

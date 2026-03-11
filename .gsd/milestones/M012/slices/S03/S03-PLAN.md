# S03: Multi Query Retrieval Core

**Goal:** Build the RET-07 algorithmic core with TDD: deterministic multi-query expansion plus deterministic merged ranking behavior.
**Demo:** Build the RET-07 algorithmic core with TDD: deterministic multi-query expansion plus deterministic merged ranking behavior.

## Must-Haves


## Tasks

- [x] **T01: 68-multi-query-retrieval-core 01** `est:2m21s`
  - Build the RET-07 algorithmic core with TDD: deterministic multi-query expansion plus deterministic merged ranking behavior.

Purpose: Phase 68 depends on predictable retrieval behavior under retries, cache reuse, and fail-open error handling. A pure-function TDD module isolates that logic and locks correctness before pipeline wiring.
Output: `src/learning/multi-query-retrieval.ts` and `src/learning/multi-query-retrieval.test.ts` with RED->GREEN coverage for variant generation, stable ordering, and error isolation.
- [x] **T02: 68-multi-query-retrieval-core 02** `est:7m32s`
  - Integrate Phase 68 multi-query retrieval into live review and mention execution paths with deterministic merged context and fail-open behavior.

Purpose: Deliver full RET-07 outcome across user-facing surfaces, not only pure functions, while preserving reliability and latency constraints established in Phases 66-67.
Output: Review and mention handlers use shared multi-query retrieval orchestration, prompt wiring is updated, and regressions lock deterministic/fail-open behavior.

## Files Likely Touched

- `src/learning/multi-query-retrieval.ts`
- `src/learning/multi-query-retrieval.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/learning/multi-query-retrieval.ts`

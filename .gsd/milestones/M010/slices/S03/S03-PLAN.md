# S03: Intelligence Layer

**Goal:** Create the adaptive distance threshold computation module using TDD.
**Demo:** Create the adaptive distance threshold computation module using TDD.

## Must-Haves


## Tasks

- [x] **T01: 58-intelligence-layer 01** `est:3 min`
  - Create the adaptive distance threshold computation module using TDD.

Purpose: This pure function is the algorithmic core of Phase 58 -- it takes a sorted array of candidate distances and determines the optimal cutoff using max-gap detection (8+ candidates) or percentile fallback (fewer candidates). TDD is ideal because the function has well-defined inputs and outputs with many edge cases.

Output: `src/learning/adaptive-threshold.ts` with full test coverage in `src/learning/adaptive-threshold.test.ts`
- [x] **T02: 58-intelligence-layer 02** `est:7 min`
  - Wire the adaptive threshold into the retrieval pipeline and extend telemetry.

Purpose: This plan restructures the retrieval pipeline so adaptive thresholds are computed on post-rerank distances (after language reranking + recency weighting), replaces the pre-rerank distance filter in the isolation layer with an increased internal topK, and logs the threshold method in retrieval telemetry for observability.

Output: Complete end-to-end adaptive threshold pipeline with telemetry logging.

## Files Likely Touched

- `src/learning/adaptive-threshold.ts`
- `src/learning/adaptive-threshold.test.ts`
- `src/learning/isolation.ts`
- `src/handlers/review.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/execution/config.ts`

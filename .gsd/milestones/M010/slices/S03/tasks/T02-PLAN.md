# T02: 58-intelligence-layer 02

**Slice:** S03 — **Milestone:** M010

## Description

Wire the adaptive threshold into the retrieval pipeline and extend telemetry.

Purpose: This plan restructures the retrieval pipeline so adaptive thresholds are computed on post-rerank distances (after language reranking + recency weighting), replaces the pre-rerank distance filter in the isolation layer with an increased internal topK, and logs the threshold method in retrieval telemetry for observability.

Output: Complete end-to-end adaptive threshold pipeline with telemetry logging.

## Must-Haves

- [ ] "When retrieval returns 8+ candidates, Kodiai applies max-gap detection to find the natural distance cutoff"
- [ ] "When fewer than 8 candidates are returned, Kodiai falls back to percentile-based threshold"
- [ ] "Adaptive thresholds are bounded by floor 0.15 and ceiling 0.65"
- [ ] "Threshold selection method (adaptive/percentile/configured) is logged in retrieval telemetry"

## Files

- `src/learning/isolation.ts`
- `src/handlers/review.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/execution/config.ts`

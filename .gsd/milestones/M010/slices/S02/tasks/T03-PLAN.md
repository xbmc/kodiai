# T03: 57-analysis-layer 03

**Slice:** S02 — **Milestone:** M010

## Description

Wire usage analysis, scope coordination, and recency weighting into the review pipeline and prompt rendering.

Purpose: Connect the three pure-function modules from Plans 01 and 02 into the live review handler and prompt builder, completing DEP-04, DEP-06, and RET-04 integration.

Output: Modified review handler, review prompt builder, and DepBumpContext type

## Must-Haves

- [ ] "When a dep bump has breaking changes, Kodiai greps workspace and surfaces file:line usage evidence in the review prompt"
- [ ] "When multiple scoped packages are updated together, Kodiai notes the coordination in the review prompt"
- [ ] "Recency weighting is applied after language reranking in the retrieval pipeline"
- [ ] "Usage analysis completes within 3-second budget and fails open"
- [ ] "Recency weighting chains without disrupting existing retrieval quality telemetry"

## Files

- `src/lib/dep-bump-detector.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`

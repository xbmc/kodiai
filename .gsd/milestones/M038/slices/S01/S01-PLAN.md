# S01: Graph/Corpus Consumer Adapters and Orchestration

**Goal:** Create the consumer-facing adapters and orchestration that combine graph blast radius with canonical unchanged-code retrieval without leaking substrate internals into the review handler.
**Demo:** After this: After this, M038 can ask M040 and M041 for structural and semantic context through explicit adapters and produce a bounded internal structural-impact payload for a C++ or Python change.

## Tasks
- [x] **T01: Defined StructuralImpactPayload, GraphAdapter, CorpusAdapter contracts and boundStructuralImpactPayload assembly in src/structural-impact/ with 18 passing tests and clean tsc** — - Define the consumer-facing structural-impact types and adapter contracts for graph and canonical-corpus queries.
- Keep the adapters explicitly dependent on M040/M041 interfaces rather than reaching into substrate internals.
- Model bounded payload fields for callers, dependents, impacted files, likely tests, and unchanged-code evidence.
  - Estimate: 0.5-1d
  - Files: src/structural-impact/types.ts, src/structural-impact/adapters.ts, src/structural-impact/adapters.test.ts
  - Verify: bun test ./src/structural-impact/adapters.test.ts && bun run tsc --noEmit
- [ ] **T02: Build structural-impact orchestration with cache and timeout** — - Implement orchestration that queries graph blast radius and canonical current-code evidence together.
- Add timeout, partial-result, and cache-reuse behavior at the orchestration boundary.
- Keep the result bounded before any formatting logic runs.
  - Estimate: 1d
  - Files: src/structural-impact/orchestrator.ts, src/structural-impact/orchestrator.test.ts, src/structural-impact/adapters.ts
  - Verify: bun test ./src/structural-impact/orchestrator.test.ts
- [ ] **T03: Add review-path integration seam** — - Add a review-path integration seam that lets the handler request structural-impact data through the new orchestration layer.
- Keep the integration behind a single module boundary so later substrate API changes do not sprawl through `review.ts`.
- Add tests using stubbed graph/corpus adapters.
  - Estimate: 0.5-1d
  - Files: src/structural-impact/review-integration.ts, src/structural-impact/review-integration.test.ts, src/handlers/review.ts
  - Verify: bun test ./src/structural-impact/review-integration.test.ts

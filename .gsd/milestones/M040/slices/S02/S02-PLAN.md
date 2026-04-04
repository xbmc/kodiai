# S02: Blast-Radius Queries and Graph-Aware Review Selection

**Goal:** Turn the persisted graph into useful review-selection signals: blast radius, impacted files, likely tests, and graph-aware ranking for extensive reviews.
**Demo:** After this: After this, Kodiai can take a large fixture PR and show graph-ranked impacted files, probable dependents, and likely tests that today's file-risk scorer alone would miss.

## Tasks
- [ ] **T01: Add blast-radius and likely-test queries** — - Implement graph query surfaces for blast radius, impacted files, probable dependents, and likely tests.
- Add confidence/ranking output instead of pretending every graph edge is equally certain.
- Prove query usefulness against C++ and Python fixtures.
  - Estimate: 1d
  - Files: src/review-graph/query.ts, src/review-graph/query.test.ts, src/review-graph/store.ts
  - Verify: bun test ./src/review-graph/query.test.ts && bun run tsc --noEmit
- [ ] **T02: Integrate graph signals into extensive-review selection** — - Extend large-PR review selection to consume graph signals alongside current file-risk scoring.
- Keep the existing non-graph path as the fallback and preserve bounded ranking behavior.
- Wire graph-aware selection into the review handler before prompt packing.
  - Estimate: 1d
  - Files: src/lib/file-risk-scorer.ts, src/handlers/review.ts, src/lib/file-risk-scorer.test.ts
  - Verify: bun test ./src/lib/file-risk-scorer.test.ts
- [ ] **T03: Add graph-aware selection verifier** — - Add a fixture-based verifier comparing current file-level selection with graph-aware selection on a production-like large PR shape.
- Prove graph-aware selection surfaces impacted files/tests that current triage alone would miss.
- Keep proof output machine-checkable for later milestone closure.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m040-s02.ts, scripts/verify-m040-s02.test.ts, src/review-graph/query.ts, src/lib/file-risk-scorer.ts
  - Verify: bun test ./scripts/verify-m040-s02.test.ts && bun run verify:m040:s02 -- --json

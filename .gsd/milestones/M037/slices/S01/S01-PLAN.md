# S01: Cluster Model Build and Cache

**Goal:** Build the cluster-model substrate: model schema, builder, cache, and bounded background refresh entrypoint.
**Demo:** After this: After this, Kodiai can build and cache a per-repo positive/negative cluster model from learning memories instead of recomputing it on every review.

## Tasks
- [x] **T01: Added suggestion_cluster_models table migration, SuggestionClusterStore factory, and 29 unit tests for cluster model persistence and retrieval** — - Add cluster-model schema and store surfaces for positive/negative centroids and freshness metadata.
- Keep model storage separate from durable generated rules.
- Add tests for model persistence and retrieval.
  - Estimate: 0.5-1d
  - Files: src/db/migrations/036-suggestion-cluster-models.sql, src/knowledge/suggestion-cluster-store.ts, src/knowledge/suggestion-cluster-store.test.ts
  - Verify: bun test ./src/knowledge/suggestion-cluster-store.test.ts && bun run tsc --noEmit
- [x] **T02: Add buildClusterModel function with HDBSCAN-based positive/negative centroid generation from learning memories** — - Build per-repo positive/negative cluster model generation from learning memories.
- Reuse existing clustering helpers and enforce minimum-member thresholds.
- Add tests for centroid generation and bounded model shape.
  - Estimate: 1d
  - Files: src/knowledge/suggestion-cluster-builder.ts, src/knowledge/suggestion-cluster-builder.test.ts, src/knowledge/cluster-matcher.ts, src/knowledge/cluster-pipeline.ts
  - Verify: bun test ./src/knowledge/suggestion-cluster-builder.test.ts
- [x] **T03: Added suggestion-cluster-refresh module (20 unit tests) and confirmed verify-m037-s01 harness passes (20 tests) — all 40 tests green, tsc clean** — - Add the bounded background refresh entrypoint for cluster models.
- Keep refresh decoupled from the live review path.
- Add a verifier proving cached models are built and read without per-review rebuilds.
  - Estimate: 0.5-1d
  - Files: src/knowledge/suggestion-cluster-refresh.ts, src/knowledge/suggestion-cluster-refresh.test.ts, scripts/verify-m037-s01.ts, scripts/verify-m037-s01.test.ts
  - Verify: bun test ./src/knowledge/suggestion-cluster-refresh.test.ts && bun test ./scripts/verify-m037-s01.test.ts

# S02: Thematic Finding Scoring and Review Integration

**Goal:** Integrate thematic cluster scoring into the review pipeline as an ephemeral pre-comment adjustment layer.
**Demo:** After this: After this, review-time findings can be scored against cached cluster models so persistently-negative themes are suppressed and persistently-positive themes boost confidence, subject to safety guards.

## Tasks
- [ ] **T01: Score findings against thematic cluster models** — - Implement thematic scoring for draft findings against positive and negative cluster centroids.
- Return suppression and confidence-adjustment signals without mutating durable rule state.
- Add scoring tests for conservative thresholds.
  - Estimate: 0.5-1d
  - Files: src/knowledge/suggestion-cluster-scoring.ts, src/knowledge/suggestion-cluster-scoring.test.ts, src/knowledge/suggestion-cluster-store.ts
  - Verify: bun test ./src/knowledge/suggestion-cluster-scoring.test.ts && bun run tsc --noEmit
- [ ] **T02: Integrate thematic scoring into review generation** — - Wire cluster scoring into the review pipeline before comment creation.
- Reuse safety-guard and confidence-adjuster paths instead of inventing parallel logic.
- Add tests proving CRITICAL findings bypass suppression and lower-severity findings can be adjusted.
  - Estimate: 1d
  - Files: src/handlers/review.ts, src/feedback/confidence-adjuster.ts, src/feedback/confidence-adjuster.test.ts, src/feedback/safety-guard.ts
  - Verify: bun test ./src/feedback/confidence-adjuster.test.ts
- [ ] **T03: Add scoring and review-path verifier** — - Add a verifier showing cached cluster models change the final finding set or confidence compared with the naive path.
- Keep proof output machine-checkable and bounded.
- Cover safety-guarded CRITICAL finding behavior.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m037-s02.ts, scripts/verify-m037-s02.test.ts, src/knowledge/suggestion-cluster-scoring.ts, src/handlers/review.ts
  - Verify: bun test ./scripts/verify-m037-s02.test.ts && bun run verify:m037:s02 -- --json

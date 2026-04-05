# S03: Refresh, Staleness Handling, and Fail-Open Verification

**Goal:** Harden refresh, stale-model handling, and fail-open review behavior for the ephemeral reinforcement layer.
**Demo:** After this: After this, cluster models refresh in the background, stale/unavailable models degrade cleanly, and the verifier proves cached reuse plus non-blocking behavior.

## Tasks
- [x] **T01: Added suggestion-cluster-staleness module with 4-hour grace-period policy, four staleness states, structured observability signals, and 22 passing tests** — - Finalize refresh cadence and stale-model handling for cached cluster models.
- Keep stale models usable only within bounded policy, then degrade to no-scoring.
- Add tests for fresh, stale, and missing-model paths.
  - Estimate: 0.5-1d
  - Files: src/knowledge/suggestion-cluster-staleness.ts, src/knowledge/suggestion-cluster-staleness.test.ts, src/knowledge/suggestion-cluster-refresh.ts
  - Verify: bun test ./src/knowledge/suggestion-cluster-staleness.test.ts && bun run tsc --noEmit
- [ ] **T02: Harden fail-open scoring degradation** — - Harden fail-open behavior so unavailable cluster models or scoring failures never block review completion.
- Ensure user-visible output does not pretend a boost or suppression happened when scoring was skipped.
- Add degradation tests across each failure mode.
  - Estimate: 0.5-1d
  - Files: src/knowledge/suggestion-cluster-degradation.ts, src/knowledge/suggestion-cluster-degradation.test.ts, src/handlers/review.ts
  - Verify: bun test ./src/knowledge/suggestion-cluster-degradation.test.ts
- [ ] **T03: Add refresh and fail-open verifier** — - Add the milestone-level verifier covering cache reuse, refresh, staleness, and fail-open review completion.
- Keep proof output stable enough to close M037 without hand inspection.
- Cover the path where the review falls back to the naive behavior.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m037-s03.ts, scripts/verify-m037-s03.test.ts, src/knowledge/suggestion-cluster-refresh.ts, src/knowledge/suggestion-cluster-degradation.ts, src/handlers/review.ts
  - Verify: bun test ./scripts/verify-m037-s03.test.ts && bun run verify:m037:s03 -- --json

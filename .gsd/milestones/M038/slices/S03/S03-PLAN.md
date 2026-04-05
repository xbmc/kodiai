# S03: Timeout, Cache Reuse, and Fail-Open Verification

**Goal:** Harden the consumer path with explicit timeout, cache reuse, truthful degradation, and milestone-level machine-checkable proof.
**Demo:** After this: After this, repeated reviews reuse cached structural-impact results, substrate failures degrade cleanly, and the verifier proves bounded fail-open structural output for both large-review and timeout paths.

## Tasks
- [x] **T01: Added bounded structural-impact cache reuse and verified timeout and partial-result behavior.** — - Finalize structural-impact cache policy keyed by repo/base/head and integrate explicit timeout handling.
- Ensure repeated review requests reuse cached combined structural-impact results.
- Add tests for timeout, cache-hit, and partial-result behavior.
  - Estimate: 0.5-1d
  - Files: src/structural-impact/cache.ts, src/structural-impact/cache.test.ts, src/structural-impact/orchestrator.ts
  - Verify: bun test ./src/structural-impact/cache.test.ts && bun run tsc --noEmit
- [ ] **T02: Harden fail-open degradation paths** — - Harden degradation behavior so missing graph data, missing corpus data, or total substrate failure never blocks review completion.
- Ensure the user-visible output stays truthful: no invented caller counts or fake structural certainty.
- Add tests for graceful fallback across each failure mode.
  - Estimate: 0.5-1d
  - Files: src/structural-impact/degradation.ts, src/structural-impact/degradation.test.ts, src/handlers/review.ts, src/lib/structural-impact-formatter.ts
  - Verify: bun test ./src/structural-impact/degradation.test.ts
- [ ] **T03: Add fail-open and cache-reuse verifier** — - Add the milestone-level verifier covering success, cache reuse, timeout, and substrate-failure paths.
- Prove the review completes without blocking, Structural Impact stays bounded, and breaking-change output only claims what the evidence supports.
- Keep proof output stable enough to close M038 without hand inspection.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m038-s03.ts, scripts/verify-m038-s03.test.ts, src/structural-impact/cache.ts, src/structural-impact/degradation.ts, src/handlers/review.ts
  - Verify: bun test ./scripts/verify-m038-s03.test.ts && bun run verify:m038:s03 -- --json

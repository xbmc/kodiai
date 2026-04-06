# S03: Cache, Fallback, and Regression Hardening

**Goal:** Harden contributor-tier cache and fallback behavior so repeated or degraded review runs preserve truthful author labeling, and lock the CrystalP repro plus adjacent contributor-history cases behind deterministic handler and verifier regressions.
**Demo:** After this: After this, cache reuse and fallback classification preserve truthful contributor labeling, and regressions cover the repro plus adjacent contributor-history cases so the bug does not silently return.

## Tasks
- [x] **T01: Bounded author-tier cache reuse to fallback taxonomy values and added regressions so unsupported cached tiers cannot overclaim contributor seniority.** — Audit and tighten the `resolveAuthorClassification()` path in `src/handlers/review.ts` so cache reuse and fallback classification stay explicitly bounded by source fidelity. Keep the change local to the review author-tier seam unless a small type/store contract improvement is clearly justified. If cache values need normalization or validation, implement it where the handler reads/writes them and preserve fail-open behavior rather than introducing a blocking path.

Document the concrete assumptions in code comments or tests: contributor profile is the highest-fidelity source, cached fallback taxonomy is lower-fidelity and may be reused only as-is, and degraded fallback must never claim `established`/`senior` knowledge it does not actually have.
  - Estimate: 1.5h
  - Files: src/handlers/review.ts, src/knowledge/types.ts, src/knowledge/store.ts, src/lib/author-classifier.ts
  - Verify: bun test ./src/handlers/review.test.ts
- [ ] **T02: Add handler regressions for cache-hit, contradictory-cache, and retry truthfulness** — Expand `src/handlers/review.test.ts` using the existing handler scaffolding rather than new broad test harnesses. Add focused scenarios that assert on the full rendered prompt/details bodies and prove: cached `core` maps to senior-style wording; cached `regular` maps to developing wording without overclaiming; contributor-profile `established` or `senior` still beats contradictory cached low-tier data in a real handler execution; and retry/degraded paths continue to thread the same resolved author tier into rebuilt prompt output.

Follow the established project rule from M028/S03/T02 and S02: assert on full rendered bodies with required and banned phrases, not proxy metadata or single marker lines.
  - Estimate: 2h
  - Files: src/handlers/review.test.ts, src/handlers/review.ts, src/execution/review-prompt.ts, src/lib/review-utils.ts
  - Verify: bun test ./src/handlers/review.test.ts
- [ ] **T03: Build the M042/S03 cache-and-fallback proof harness** — Add a deterministic slice verifier for the remaining M042 contract and register it in `package.json`. Compose production seams rather than duplicating business logic: use `resolveAuthorTierFromSources()`, `buildReviewPrompt()`, `formatReviewDetailsSummary()`, and any small helper exports needed to prove cache-hit truthfulness, contributor-profile override of contradictory cache, and degraded fallback non-contradiction. Include stable check IDs and JSON/text output matching the established verifier pattern.

The harness should complement, not replace, T02 handler tests: keep orchestration-only behavior in handler tests and use the verifier for stable contract checks that milestone closure can rerun unchanged.
  - Estimate: 1.5h
  - Files: scripts/verify-m042-s03.ts, scripts/verify-m042-s03.test.ts, package.json, src/handlers/review.ts, src/execution/review-prompt.ts, src/lib/review-utils.ts
  - Verify: bun test ./scripts/verify-m042-s03.test.ts && bun run verify:m042:s03

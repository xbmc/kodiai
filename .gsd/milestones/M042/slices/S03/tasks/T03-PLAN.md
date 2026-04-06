---
estimated_steps: 2
estimated_files: 6
skills_used: []
---

# T03: Build the M042/S03 cache-and-fallback proof harness

Add a deterministic slice verifier for the remaining M042 contract and register it in `package.json`. Compose production seams rather than duplicating business logic: use `resolveAuthorTierFromSources()`, `buildReviewPrompt()`, `formatReviewDetailsSummary()`, and any small helper exports needed to prove cache-hit truthfulness, contributor-profile override of contradictory cache, and degraded fallback non-contradiction. Include stable check IDs and JSON/text output matching the established verifier pattern.

The harness should complement, not replace, T02 handler tests: keep orchestration-only behavior in handler tests and use the verifier for stable contract checks that milestone closure can rerun unchanged.

## Inputs

- `scripts/verify-m042-s02.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/lib/review-utils.ts`
- `package.json`
- `.gsd/milestones/M042/slices/S03/S03-RESEARCH.md`

## Expected Output

- `scripts/verify-m042-s03.ts`
- `scripts/verify-m042-s03.test.ts`
- `package.json`

## Verification

bun test ./scripts/verify-m042-s03.test.ts && bun run verify:m042:s03

## Observability Impact

`bun run verify:m042:s03` becomes the durable slice inspection surface. Its named checks should localize failures to cache-hit surface mapping, profile-over-cache precedence, or degraded fallback truthfulness without needing live GitHub or DB access.

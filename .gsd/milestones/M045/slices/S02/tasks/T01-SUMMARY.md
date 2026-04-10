---
id: T01
parent: S02
milestone: M045
key_files:
  - src/contributor/experience-contract.ts
  - src/contributor/experience-contract.test.ts
  - src/knowledge/multi-query-retrieval.ts
  - src/knowledge/multi-query-retrieval.test.ts
  - src/knowledge/retrieval-query.ts
  - src/knowledge/retrieval-query.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D068 — Project retrieval hints from the contributor-experience contract, not raw tiers.
  - RET-07 retrieval tests must identify variants without assuming generic states emit an `author:` fragment.
duration: 
verification_result: passed
completed_at: 2026-04-09T16:56:11.384Z
blocker_discovered: false
---

# T01: Moved review-time retrieval off raw contributor tiers by projecting contract-approved author hints and suppressing hints for generic states.

**Moved review-time retrieval off raw contributor tiers by projecting contract-approved author hints and suppressing hints for generic states.**

## What Happened

Added `resolveContributorExperienceRetrievalHint()` to the contributor-experience contract seam and used it to own review retrieval hint policy instead of leaking `authorClassification.tier` into query construction. Profile-backed states now project normalized contributor-facing hints, coarse fallback collapses to `returning contributor`, and generic opt-out/unknown/degraded or malformed inputs emit no hint. Renamed the shared knowledge-layer input from `authorTier` to optional `authorHint` in both retrieval builders, updated the review handler to pass the contract projection, and extended review/builder tests to capture profile-backed versus generic query strings while keeping mention retrieval compatible through the optional field. Recorded D068 for the vocabulary choice and added a knowledge entry about RET-07 fixtures no longer being able to rely on `author:` as the only intent-query discriminator once generic states suppress hints correctly.

## Verification

Fresh verification passed after the final nullability fix. The slice-level regression command `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts` exited 0 and the contributor/retrieval/review/slack suites all passed. `bun run verify:m045:s01 -- --json` exited 0 with `overallPassed: true`. `bun run tsc --noEmit` exited 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts` | 0 | ✅ pass | 3183ms |
| 2 | `bun run verify:m045:s01 -- --json` | 0 | ✅ pass | 54ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 7244ms |

## Deviations

None.

## Known Issues

The slice-level test command still references `src/handlers/identity-suggest.test.ts`, but that file is not present yet; Bun currently ignores that missing path and runs the existing suite subset.

## Files Created/Modified

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/knowledge/multi-query-retrieval.ts`
- `src/knowledge/multi-query-retrieval.test.ts`
- `src/knowledge/retrieval-query.ts`
- `src/knowledge/retrieval-query.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `.gsd/DECISIONS.md`
- `.gsd/KNOWLEDGE.md`

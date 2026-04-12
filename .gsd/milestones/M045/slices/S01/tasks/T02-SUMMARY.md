---
id: T02
parent: S01
milestone: M045
key_files:
  - src/contributor/experience-contract.ts
  - src/contributor/experience-contract.test.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Added contract-level promptPolicy projections and threaded contributorExperienceContract through runtime review prompt construction, while leaving raw authorTier as a legacy-only compatibility path for non-runtime callers until verifier migration lands.
  - Collapse coarse-fallback prompt behavior to one explicit low-confidence section so runtime prompt behavior cannot overclaim established/senior familiarity from fallback tiers.
duration: 
verification_result: mixed
completed_at: 2026-04-09T11:25:10.394Z
blocker_discovered: false
---

# T02: Moved GitHub review prompt author-experience wording onto the contributor-experience contract and pinned the prompt matrix.

**Moved GitHub review prompt author-experience wording onto the contributor-experience contract and pinned the prompt matrix.**

## What Happened

Extended src/contributor/experience-contract.ts with a contract-level promptPolicy projection plus explicit prompt-section helpers for profile-backed, coarse-fallback, and generic unknown/opt-out/degraded states. Updated src/execution/review-prompt.ts so runtime prompt shaping now prefers contributorExperienceContract and only uses raw authorTier as a legacy compatibility path for non-runtime callers. Updated src/handlers/review.ts so both the primary review path and retry/rebuild path pass the full contract object plus profile-backed expertise into prompt construction, preventing coarse fallback or generic states from reviving established/senior phrasing. Expanded prompt, contract, and handler tests to pin the new matrix, including malformed-contract fallback-to-generic behavior and cache-hit/core fallback regressions. Recorded D065 for the promptPolicy decision and added a knowledge entry documenting that runtime review code must pass contributorExperienceContract while raw authorTier remains legacy-only until verifier migration lands.

## Verification

Task-local verification passed with `bun test ./src/contributor/experience-contract.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts`. Slice-level partial verification also ran: `bun run verify:m042:s02 && bun run verify:m042:s03` passed, but `bun run verify:m045:s01` still fails because the verifier command does not exist yet (planned for T03). `bun run tsc --noEmit` still fails on unrelated pre-existing issues in `scripts/verify-m044-s01.test.ts` and `src/handlers/review-idempotency.ts`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/experience-contract.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts` | 0 | ✅ pass | 4306ms |
| 2 | `bun run verify:m042:s02 && bun run verify:m042:s03 && bun run verify:m045:s01` | 1 | ❌ fail | 490ms |
| 3 | `bun run tsc --noEmit` | 2 | ❌ fail | 8560ms |

## Deviations

Kept `buildReviewPrompt(authorTier)` as a legacy compatibility path for non-runtime verifier/script callers instead of removing it immediately. Runtime review code now uses `contributorExperienceContract`; remaining raw-tier callers are intentionally deferred to T03 so this task could land the contract-driven runtime behavior without breaking older verifier fixtures mid-slice.

## Known Issues

`bun run verify:m045:s01` is still missing and will remain red until T03 adds the verifier. `bun run tsc --noEmit` still reports unrelated pre-existing errors in `scripts/verify-m044-s01.test.ts` and `src/handlers/review-idempotency.ts`.

## Files Created/Modified

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `.gsd/KNOWLEDGE.md`

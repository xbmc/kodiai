---
id: T01
parent: S01
milestone: M045
key_files:
  - src/contributor/experience-contract.ts
  - src/contributor/experience-contract.test.ts
  - src/contributor/types.ts
  - src/contributor/profile-store.ts
  - src/contributor/profile-store.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - scripts/verify-m038-s02.ts
  - scripts/verify-m042-s02.ts
  - scripts/verify-m042-s03.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Model GitHub review contributor experience as explicit contract states instead of exposing raw mixed tier strings in Review Details.
  - Use `getByGithubUsername(..., { includeOptedOut: true })` for review-time system lookups, then collapse opted-out profiles back to a generic contract state.
  - Gate prompt adaptation through the resolved contract for generic states now, while leaving broader prompt/retrieval unification for the next task.
duration: 
verification_result: mixed
completed_at: 2026-04-09T10:46:31.394Z
blocker_discovered: false
---

# T01: Added typed contributor-experience contract resolution for GitHub reviews, surfaced contract state in Review Details, and removed the knowledgeStore dependency from review-time contract selection.

**Added typed contributor-experience contract resolution for GitHub reviews, surfaced contract state in Review Details, and removed the knowledgeStore dependency from review-time contract selection.**

## What Happened

Added `src/contributor/experience-contract.ts` as the typed GitHub review contract seam with explicit `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, and `generic-degraded` states plus Review Details wording. Extended contributor-profile lookup with `includeOptedOut` so review-time/system code can distinguish opted-out profiles without restoring profile-backed behavior. Updated `src/handlers/review.ts` to resolve contributor experience even when `knowledgeStore` is absent, preserve M042 precedence, gate prompt adaptation for generic states, and log `contributorExperienceState`, `contributorExperienceSource`, and `contributorExperienceDegradationPath`. Updated `src/lib/review-utils.ts` to consume a contract projection instead of raw `authorTier` text. Added/updated targeted tests for the five-state matrix, knowledge-store-absent resolution, Review Details wording, and structured log inspection. Also updated the M038/M042 verifier scripts that call `formatReviewDetailsSummary()` so the repo still compiles against the renamed Review Details contract.

## Verification

Task-local verification passed via `bun test ./src/contributor/experience-contract.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts`. Slice-level partial verification also ran: the broader test sweep including `review-prompt.test.ts` passed for the currently present files; `verify:m042:s02` and `verify:m042:s03` passed after updating them for the new Review Details contract; `verify:m045:s01` is still missing pending T03; and `bun run tsc --noEmit` still fails only on unrelated pre-existing errors in `scripts/verify-m044-s01.test.ts` and `src/handlers/review-idempotency.ts`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/experience-contract.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts` | 0 | ✅ pass | 3145ms |
| 2 | `bun test ./src/contributor/experience-contract.test.ts ./src/handlers/review.test.ts ./src/execution/review-prompt.test.ts ./src/lib/review-utils.test.ts ./scripts/verify-m045-s01.test.ts` | 0 | ✅ pass | 3197ms |
| 3 | `bun run verify:m042:s02 && bun run verify:m042:s03 && bun run verify:m045:s01` | 1 | ❌ fail | 325ms |
| 4 | `bun run tsc --noEmit` | 2 | ❌ fail | 7578ms |

## Deviations

Updated `scripts/verify-m038-s02.ts`, `scripts/verify-m042-s02.ts`, and `scripts/verify-m042-s03.ts` so existing verifier call sites compile and continue checking the renamed Review Details contract. No other plan deviations.

## Known Issues

`bun run verify:m045:s01` still fails because the command/script does not exist yet (expected until T03). `bun run tsc --noEmit` still reports unrelated pre-existing errors in `scripts/verify-m044-s01.test.ts` and `src/handlers/review-idempotency.ts`. The DB-backed contributor-profile store integration suite remains environment-blocked because the configured `DATABASE_URL` points at an unreachable host.

## Files Created/Modified

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/profile-store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `scripts/verify-m038-s02.ts`
- `scripts/verify-m042-s02.ts`
- `scripts/verify-m042-s03.ts`
- `.gsd/KNOWLEDGE.md`

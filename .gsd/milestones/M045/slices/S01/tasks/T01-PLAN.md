---
estimated_steps: 7
estimated_files: 8
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Resolve contributor signals into one GitHub review contract and surface it in Review Details

Define the typed contract seam before touching prompt behavior so the review path can answer what it knows, how certain it is, and what Review Details may say for profile-backed, coarse fallback, unknown, opted-out, and degraded scenarios.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `contributorProfileStore` | Fail open to a non-profile contract state, log the downgrade, and never throw from review handling. | Treat the profile signal as unavailable and continue with cache/fallback/unknown resolution. | Ignore invalid profile data and continue with a generic or coarse contract state. |
| `knowledgeStore` / `author_cache` | Skip cache reuse and continue with profile/fallback resolution. | Treat cache as unavailable and do not block the review. | Reject unsupported cached tiers and continue without cache reuse. |
| GitHub Search PR-count lookup | Fall back to a coarse or unknown contract state while keeping the degraded reason inspectable. | Same as error; mark the signal degraded instead of guessing confidence. | Ignore the count and use association-only coarse behavior. |

## Load Profile

- **Shared resources**: GitHub Search API quota, `authorPrCountSearchCache`, contributor-profile reads.
- **Per-operation cost**: at most one contributor profile read, one cache read/write, and one bounded PR-count search with a single retry.
- **10x breakpoint**: secondary rate limiting or cache churn should force a generic/degraded contract state rather than pile up retries.

## Negative Tests

- **Malformed inputs**: unsupported cached tier, missing profile tier, and absent `knowledgeStore` still resolve to a typed contract state.
- **Error paths**: contributor profile read failure, author-cache failure, and second Search API rate-limit all fail open without silently defaulting to the old `regular` path.
- **Boundary conditions**: opted-out profile, no repo history, and cached coarse signal with contradictory profile data each produce deterministic precedence.

## Steps

1. Add `src/contributor/experience-contract.ts` plus `src/contributor/experience-contract.test.ts` with one exported projection helper that maps source provenance/coarseness/opt-out/degradation into GitHub review contract states and Review Details wording.
2. Extend contributor-profile access in `src/contributor/types.ts` / `src/contributor/profile-store.ts` so review-time system lookups can detect opted-out profiles without resurrecting them as normal profile-backed personalization.
3. Update `src/handlers/review.ts` to resolve the contract even when `knowledgeStore` is absent, preserving M042 precedence while emitting explicit `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, and `generic-degraded` outcomes.
4. Change `src/lib/review-utils.ts` and its tests to accept the new Review Details projection instead of raw `authorTier?: string`, and make the visible Review Details line truthful for each contract state.

## Must-Haves

- [ ] The new contract separates signal provenance/coarseness from visible GitHub review behavior.
- [ ] Review-time resolution no longer depends on `knowledgeStore` presence just to decide whether contributor experience applies.
- [ ] Review Details can distinguish profile-backed, coarse fallback, unknown, opted-out, and degraded behavior without leaking raw mixed-tier internals.

## Inputs

- `src/lib/author-classifier.ts`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/handlers/review.ts`
- `src/lib/review-utils.ts`

## Expected Output

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`

## Verification

bun test ./src/contributor/experience-contract.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts

## Observability Impact

- Signals added/changed: resolved contributor-experience source/state/degradation fields on the existing handler classification log plus a deterministic Review Details contract line.
- How a future agent inspects this: run the targeted contract/handler/details tests and inspect `formatReviewDetailsSummary()` output.
- Failure state exposed: precedence mistakes, opt-out leaks, or degraded overclaims show up as the wrong contract state in tests and Review Details.

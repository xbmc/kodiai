---
estimated_steps: 13
estimated_files: 5
skills_used:
  - test-driven-development
  - systematic-debugging
  - verification-before-completion
---

# T02: Route GitHub review resolution through the trust-aware profile boundary

**Slice:** S01 — Truthful contributor resolution on GitHub review
**Milestone:** M047

## Description

Make the GitHub review entrypoint consume the new stored-profile trust boundary before it decides whether contributor experience is `profile-backed`, coarse fallback, or generic. The review path must stay truthful when a stored profile is opted out, linked-but-unscored, legacy, stale, malformed, or contradicted by lower-confidence cache signals.

## Steps

1. Wire the trust helper into review-time author classification, ideally behind a focused helper seam that the proof harness can reuse.
2. Keep opt-out precedence unchanged, allow only trustworthy calibrated rows to stay `profile-backed`, and make untrusted stored rows fall through to author-cache/search/generic behavior instead of masquerading as newcomer certainty.
3. Extend review-path tests/helpers to seed linked-unscored, legacy, calibrated, stale, opt-out, and contradictory-cache scenarios through the stored-profile seam.
4. Emit explicit trust-state and fallback diagnostics in the author-classification log so failures are inspectable without re-reading the code.

## Must-Haves

- [ ] Review-time resolution only returns `profile-backed` when the stored profile is explicitly trustworthy under the new persisted trust boundary.
- [ ] Linked-unscored, legacy, stale, malformed, and opted-out rows fail open to coarse/generic behavior without overclaiming newcomer truth.
- [ ] Handler tests prove prompt text, Review Details, and logs stay coherent for calibrated, fallback, and fail-open scenarios.

## Inputs

- `src/contributor/profile-trust.ts`
- `src/contributor/experience-contract.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

## Expected Output

- `src/contributor/review-author-resolution.ts`
- `src/contributor/review-author-resolution.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

## Verification

bun test ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts

## Observability Impact

Expose the stored-profile trust state, trust reason, calibration marker, and fallback path on the existing author-classification log entry so future agents can tell why a contributor profile was trusted or bypassed.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/contributor/profile-trust.ts` / stored profile row | Treat the profile as untrusted and continue into author-cache/search/generic resolution instead of throwing from review handling. | N/A — local helper only. | Map malformed or partial stored rows to an explicit untrusted state and log why the profile was bypassed. |
| `contributorProfileStore` / `author_cache` / GitHub search fallback | Fail open to the next-lower-confidence source and keep the review runnable. | Preserve the current single-retry/skip behavior for Search API enrichment and never block the review. | Ignore malformed cache/profile data and continue with coarse or generic behavior rather than reviving `profile-backed` wording. |

## Load Profile

- **Shared resources**: `contributor_profiles`, `author_cache`, Search API quota, and the review-handler logging path.
- **Per-operation cost**: at most one stored-profile read, one cache read/write, and the existing bounded PR-count search fallback.
- **10x breakpoint**: cache/search quota pressure should push authors into coarse/generic behavior first; the resolver must not add extra retries or secondary lookups just to recover profile trust.

## Negative Tests

- **Malformed inputs**: unsupported `overall_tier`, missing calibration marker, null `last_scored_at`, contradictory cache tier, and partially populated stored profile rows.
- **Error paths**: contributor profile lookup failure, cache read failure, and Search API rate limit after a stale/untrusted profile is bypassed.
- **Boundary conditions**: linked-but-unscored row, legacy pre-M047 row, stale calibrated row, opted-out row, trustworthy calibrated retained row, and contradictory low-confidence cache data behind a trustworthy stored profile.

---
id: T02
parent: S03
milestone: M038
key_files:
  - src/structural-impact/degradation.ts
  - src/structural-impact/degradation.test.ts
  - src/structural-impact/review-integration.ts
  - src/lib/structural-impact-formatter.ts
  - src/lib/review-utils.ts
  - src/handlers/review.ts
  - src/structural-impact/review-integration.test.ts
  - src/lib/structural-impact-formatter.test.ts
key_decisions:
  - Centralized structural-impact truthfulness and fallback classification in a dedicated degradation helper rather than duplicating partial/unavailable logic across the formatter and review handler.
duration: 
verification_result: passed
completed_at: 2026-04-05T19:53:14.279Z
blocker_discovered: false
---

# T02: Hardened structural-impact fail-open degradation so review output stays truthful when graph or corpus evidence is missing.

**Hardened structural-impact fail-open degradation so review output stays truthful when graph or corpus evidence is missing.**

## What Happened

Added a dedicated structural-impact degradation normalizer, threaded it through review integration, formatter rendering, Review Details output, and handler logging, and expanded tests so graph/corpus failure paths degrade truthfully without inventing certainty or blocking review completion.

## Verification

Verified the new degradation module, review-integration behavior, formatter output, and repo compilation with targeted bun tests plus `bun run tsc --noEmit`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/structural-impact/degradation.test.ts ./src/structural-impact/review-integration.test.ts ./src/lib/structural-impact-formatter.test.ts` | 0 | ✅ pass | 28ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 1000ms |

## Deviations

None.

## Known Issues

`fetchReviewStructuralImpact` still reflects existing review-integration behavior when the corpus path returns zero evidence, so the dedicated degradation helper is the canonical truthfulness layer for status normalization rather than that function alone.

## Files Created/Modified

- `src/structural-impact/degradation.ts`
- `src/structural-impact/degradation.test.ts`
- `src/structural-impact/review-integration.ts`
- `src/lib/structural-impact-formatter.ts`
- `src/lib/review-utils.ts`
- `src/handlers/review.ts`
- `src/structural-impact/review-integration.test.ts`
- `src/lib/structural-impact-formatter.test.ts`

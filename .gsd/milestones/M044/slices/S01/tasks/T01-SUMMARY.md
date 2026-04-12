---
id: T01
parent: S01
milestone: M044
key_files:
  - src/handlers/review-idempotency.ts
  - src/handlers/review-idempotency.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Added additive parser/extractor helpers to `src/handlers/review-idempotency.ts` instead of introducing a separate ad-hoc audit regex module.
  - Normalized retry-suffixed keys into `baseReviewOutputKey`, `retryAttempt`, and `effectiveDeliveryId` so later audit code can correlate retry output without guessing.
duration: 
verification_result: mixed
completed_at: 2026-04-09T07:34:10.765Z
blocker_discovered: false
---

# T01: Added shared review-output key parsing and retry normalization helpers with regression coverage.

**Added shared review-output key parsing and retry normalization helpers with regression coverage.**

## What Happened

Implemented the first S01 seam by extending the existing review idempotency helpers with additive audit-facing parsing functions. `extractReviewOutputKey()` now pulls the marker-backed key out of a review/comment body, and `parseReviewOutputKey()` turns a base or retry-suffixed key into structured identity including repo/PR/action, base delivery ID, retry attempt, and effective retry delivery ID. I wrote the new tests first, confirmed they failed because the parser exports were missing, then added the minimal implementation and reran the targeted suite to green. I also recorded the retry identity rule in `.gsd/KNOWLEDGE.md` because later M044 correlation work depends on that non-obvious mapping.

## Verification

`bun test ./src/handlers/review-idempotency.test.ts` passed with 12 passing tests and 0 failures after adding `extractReviewOutputKey()` and `parseReviewOutputKey()` to the existing idempotency helper module.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/review-idempotency.test.ts -> 12 pass, 0 fail` | -1 | unknown (coerced from string) | 0ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/handlers/review-idempotency.ts`
- `src/handlers/review-idempotency.test.ts`
- `.gsd/KNOWLEDGE.md`

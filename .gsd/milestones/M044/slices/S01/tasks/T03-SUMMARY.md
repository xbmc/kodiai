---
id: T03
parent: S01
milestone: M044
key_files:
  - src/review-audit/evidence-correlation.ts
  - src/review-audit/evidence-correlation.test.ts
  - src/handlers/review-idempotency.ts
  - src/handlers/review-idempotency.test.ts
  - src/review-audit/recent-review-sample.ts
  - src/review-audit/recent-review-sample.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Kept explicit-lane classification honest: without publish-resolution evidence, explicit review artifacts stay `indeterminate` even when telemetry shows the execution existed.
  - Correlated automatic-lane durable evidence by parsed `effectiveDeliveryId` so retry-suffixed review-output keys resolve to the matching retry execution rows instead of the base webhook delivery.
duration: 
verification_result: mixed
completed_at: 2026-04-09T07:45:15.779Z
blocker_discovered: false
---

# T03: Added automatic-lane evidence loading, provisional verdict classification, and clean-review details-marker support.

**Added automatic-lane evidence loading, provisional verdict classification, and clean-review details-marker support.**

## What Happened

Implemented the lane-aware internal evidence and provisional classification seam for S01. The new `src/review-audit/evidence-correlation.ts` loads automatic-lane durable evidence from `reviews`, `findings`, `review_checkpoints`, and `telemetry_events` using the parsed `effectiveDeliveryId`, then classifies artifacts into `clean-valid`, `findings-published`, `suspicious-approval`, `publish-failure`, or `indeterminate`. While wiring those rules, I found that clean automatic reviews can surface only a standalone `kodiai:review-details` comment, so I added a second red-green pass to widen `extractReviewOutputKey()` and the recent-review collector to recognize review-details markers too. I reran the full M044 test slice afterward to confirm the parser, collector, and classifier still agree.

## Verification

`bun test ./src/handlers/review-idempotency.test.ts ./src/review-audit/recent-review-sample.test.ts ./src/review-audit/evidence-correlation.test.ts` passed with 23 passing tests and 0 failures, covering retry delivery correlation, review-details marker extraction, sample selection, and provisional verdict rules.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/review-idempotency.test.ts ./src/review-audit/recent-review-sample.test.ts ./src/review-audit/evidence-correlation.test.ts -> 23 pass, 0 fail` | -1 | unknown (coerced from string) | 0ms |

## Deviations

Expanded the extractor/collector seam to recognize `kodiai:review-details` markers after discovering that clean automatic reviews can publish standalone Review Details comments without a `kodiai:review-output-key` marker. This stayed within S01 scope because the audit would otherwise miss valid clean-review cases.

## Known Issues

Explicit publish-resolution evidence is still log-backed and not yet loaded by the codebase; explicit artifacts therefore remain `indeterminate` until T04/S02 add that resolver surface.

## Files Created/Modified

- `src/review-audit/evidence-correlation.ts`
- `src/review-audit/evidence-correlation.test.ts`
- `src/handlers/review-idempotency.ts`
- `src/handlers/review-idempotency.test.ts`
- `src/review-audit/recent-review-sample.ts`
- `src/review-audit/recent-review-sample.test.ts`
- `.gsd/KNOWLEDGE.md`

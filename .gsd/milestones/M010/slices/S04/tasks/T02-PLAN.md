# T02: 59-resilience-layer 02

**Slice:** S04 — **Milestone:** M010

## Description

Build the pure-function modules for partial review formatting and retry scope reduction, plus add chronic timeout detection to the telemetry store.

Purpose: These are the building blocks the review handler needs to publish partial reviews with appropriate disclaimers, compute which files to retry, and decide whether retry should be skipped for chronically timing-out repo+author pairs.
Output: `formatPartialReviewComment`, `computeRetryScope` functions with full test coverage, `countRecentTimeouts` telemetry method with `pr_author` column migration.

## Must-Haves

- [ ] "Partial review formatter produces a disclaimer header with coverage ratio and optional retry-skip reason"
- [ ] "Retry scope reducer excludes already-reviewed files and applies adaptive scope formula"
- [ ] "Telemetry store can count recent timeouts per repo+author in the last 7 days"

## Files

- `src/lib/partial-review-formatter.ts`
- `src/lib/partial-review-formatter.test.ts`
- `src/lib/retry-scope-reducer.ts`
- `src/lib/retry-scope-reducer.test.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`

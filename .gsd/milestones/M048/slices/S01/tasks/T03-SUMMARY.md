---
id: T03
parent: S01
milestone: M048
key_files:
  - src/review-audit/phase-timing-evidence.ts
  - src/review-audit/phase-timing-evidence.test.ts
  - scripts/verify-m048-s01.ts
  - scripts/verify-m048-s01.test.ts
  - src/review-audit/log-analytics.ts
  - src/review-audit/log-analytics.test.ts
  - package.json
key_decisions:
  - D106 — Query Azure Log Analytics by reviewOutputKey, effective deliveryId, and the exact phase-summary message, then emit named no-match/correlation-mismatch/invalid-payload states instead of merging drifted or partial rows.
duration: 
verification_result: mixed
completed_at: 2026-04-13T00:15:22.972Z
blocker_discovered: false
---

# T03: Shipped the M048 S01 operator latency verifier with strict Azure phase-timing normalization and JSON/human report output.

**Shipped the M048 S01 operator latency verifier with strict Azure phase-timing normalization and JSON/human report output.**

## What Happened

Added `src/review-audit/phase-timing-evidence.ts` to normalize Azure `Review phase timing summary` rows into the same six required phases used on Review Details, dedupe duplicate rows, enforce strict `reviewOutputKey`/`deliveryId` correlation, preserve timeout and unavailable phase states, and fail with named invalid/correlation statuses instead of going false-green on malformed payloads. Added `scripts/verify-m048-s01.ts` as the operator-facing verifier with `--review-output-key`, optional `--delivery-id`, and `--json` support; it derives the effective delivery id from the review key when possible, keeps the query bounded to one live review by filtering Azure on `reviewOutputKey`, `deliveryId`, and the exact phase-summary message, and renders both human and machine-readable reports with total wall-clock time, phase matrix data, and truthful unavailable states. Added focused regression suites for the normalizer and CLI, updated `src/review-audit/log-analytics.ts` and its tests with a narrow message filter, wired `verify:m048:s01` into `package.json`, and recorded the verifier correlation strategy as decision D106.

## Verification

Verified the implementation with the exact slice test command `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts`, which passed with 144 tests green. Verified type safety with `bun run tsc --noEmit`, which passed cleanly. Exercised the live operator command against a real Azure-discovered review output key; the verifier returned the expected named failure state `m048_s01_no_matching_phase_timing`, showing that the CLI is querying the right live correlation tuple and surfacing missing live phase logs truthfully rather than passing falsely.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts` | 0 | ✅ pass | 4498ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 9319ms |
| 3 | `bun run verify:m048:s01 -- --review-output-key <live reviewOutputKey> --json` | 1 | ❌ fail | 1933ms |

## Deviations

None.

## Known Issues

The live Azure verification command currently returns `m048_s01_no_matching_phase_timing` for a recent real `reviewOutputKey` because Azure contains recent `reviewOutputKey`/publication logs but no deployed `Review phase timing summary` rows yet. Local code, tests, and TypeScript all pass; live proof will require a post-deploy review run that emits the new structured phase log.

## Files Created/Modified

- `src/review-audit/phase-timing-evidence.ts`
- `src/review-audit/phase-timing-evidence.test.ts`
- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s01.test.ts`
- `src/review-audit/log-analytics.ts`
- `src/review-audit/log-analytics.test.ts`
- `package.json`

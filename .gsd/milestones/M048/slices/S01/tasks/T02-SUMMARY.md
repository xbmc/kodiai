---
id: T02
parent: S01
milestone: M048
key_files:
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - .gsd/DECISIONS.md
key_decisions:
  - D105 — Review Details renders publication timing as a degraded snapshot until the exact finalized publication duration is available from the structured log and verifier surfaces.
duration: 
verification_result: mixed
completed_at: 2026-04-13T00:00:00.453Z
blocker_discovered: false
---

# T02: Rendered stable phase timings on GitHub Review Details across standalone, append, and timeout publication paths.

**Rendered stable phase timings on GitHub Review Details across standalone, append, and timeout publication paths.**

## What Happened

Extended `src/lib/review-utils.ts` so Review Details can render a normalized phase-timing block with total wall-clock time and the six required operator phases in a fixed order. The formatter now normalizes malformed phase entries to explicit `unavailable` wording, preserves degraded wording with detail text, and omits the entire timing section only if timing formatting itself regresses unexpectedly. In `src/handlers/review.ts`, I threaded a live phase snapshot into `formatReviewDetailsSummary(...)` from the real review-phase map and added a publication-phase snapshot that stays truthful while the Review Details comment is still being written. The handler now exposes the same timing contract on the standalone Review Details path, the append-to-summary path, the append-fallback path when the summary comment cannot be found, and the timeout/partial-review path so operators still get timing disclosure when a review times out. I added focused regression coverage in `src/lib/review-utils.test.ts` for ordering plus malformed/degraded inputs and in `src/handlers/review.test.ts` for standalone, append, append-fallback, and timeout Review Details timing publication.

## Verification

Task-level verification passed with `bun test ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts` and `bun run tsc --noEmit`. Slice-level test coverage that exists today also passed with `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts`. The milestone-level live verifier command `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` still fails because the script has not been added yet; this remains the expected intermediate-task gap for T03 rather than a regression in T02.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 6874ms |
| 2 | `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts` | 0 | ✅ pass | 7023ms |
| 3 | `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` | 1 | ❌ fail | 11ms |
| 4 | `bun run tsc --noEmit` | 0 | ✅ pass | 12551ms |

## Deviations

None.

## Known Issues

`bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` still fails because the verifier script/package entry is not implemented yet; that remaining slice-level proof surface belongs to T03.

## Files Created/Modified

- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `.gsd/DECISIONS.md`

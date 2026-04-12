---
id: T01
parent: S01
milestone: M048
key_files:
  - src/jobs/types.ts
  - src/jobs/queue.ts
  - src/jobs/queue.test.ts
  - src/execution/types.ts
  - src/execution/executor.ts
  - src/execution/executor.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D104 — capture phase timings as one normalized, correlated summary assembled from queue, handler, and executor seams.
  - Treat invalid queue wait metadata as `queue wait: unavailable` instead of coercing it to `0ms`.
  - Only emit the structured phase summary when correlated identifiers are present, and keep logging failures non-blocking.
duration: 
verification_result: mixed
completed_at: 2026-04-12T23:44:26.725Z
blocker_discovered: false
---

# T01: Capture queue, executor, and publication phase timings in the live review path

**Capture queue, executor, and publication phase timings in the live review path**

## What Happened

Implemented the live timing contract at the real runtime seams instead of reconstructing timing from ad hoc log lines. `src/jobs/types.ts` and `src/jobs/queue.ts` now pass structured queue wait metadata (`queuedAtMs`, `startedAtMs`, `waitMs`) into queued jobs, and I added `src/jobs/queue.test.ts` to lock that propagation. `src/execution/types.ts` now defines normalized review/executor phase timing types, and `src/execution/executor.ts` returns truthful `executor handoff` and `remote runtime` subphases on success, timeout, failure, and malformed remote timing payloads; `src/execution/executor.test.ts` covers those paths. In `src/handlers/review.ts`, I added a fail-open phase tracker that timestamps `workspace preparation`, `retrieval/context assembly`, merges the executor phases, validates queue metadata instead of coercing bad values to `0ms`, tracks `publication`, and emits one structured `Review phase timing summary` log correlated by `deliveryId` and `reviewOutputKey`. `src/handlers/review.test.ts` now verifies the six required phases plus the invalid queue-wait path. I also fixed the ACA executor test harness to avoid recursively copying a temp repo into its own child directory, and recorded that gotcha in `.gsd/KNOWLEDGE.md`.

## Verification

Task-level verification passed with `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts` and `bun run tsc --noEmit`. Slice-level tests that exist today also passed with `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts`. The slice-wide verifier command `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` currently fails because the script/package entry does not exist yet; that surface is planned for T03, so this is an expected intermediate-task gap rather than a regression in T01.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 4856ms |
| 2 | `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts` | 0 | ✅ pass | 6080ms |
| 3 | `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` | 1 | ❌ fail | 3ms |
| 4 | `bun run tsc --noEmit` | 0 | ✅ pass | 10289ms |

## Deviations

Added `src/jobs/queue.test.ts` because the planned queue test file did not exist in the repo. Also adjusted the executor test harness so it does not recursively copy a temp repo into its own child directory when the synthetic workspace dir and source repo dir are the same.

## Known Issues

`bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` is not available yet because the verifier script/package entry has not been implemented; T03 owns that operator surface.

## Files Created/Modified

- `src/jobs/types.ts`
- `src/jobs/queue.ts`
- `src/jobs/queue.test.ts`
- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/execution/executor.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `.gsd/KNOWLEDGE.md`

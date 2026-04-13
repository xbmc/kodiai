---
id: T01
parent: S02
milestone: M048
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - scripts/test-aca-job.ts
  - .gsd/KNOWLEDGE.md
  - .gsd/DECISIONS.md
key_decisions:
  - D108 — centralize ACA polling at a shared 5s default and log malformed/unknown execution-status drift at debug level while preserving existing timeout and terminal semantics.
duration: 
verification_result: mixed
completed_at: 2026-04-13T01:00:11.186Z
blocker_discovered: false
---

# T01: Cut ACA job polling from 10s to a shared 5s default and added retry/malformed-status diagnostics with focused coverage.

**Cut ACA job polling from 10s to a shared 5s default and added retry/malformed-status diagnostics with focused coverage.**

## What Happened

I followed a red-green cycle in `src/jobs/aca-launcher.test.ts` first, adding failing coverage for first-poll success, retry after HTTP/fetch failures, malformed payload drift, and boundary timeout behavior. Those tests failed against the old implementation because `pollUntilComplete(...)` still defaulted to a 10s cadence and did not surface malformed execution payload drift distinctly.

I then refactored `src/jobs/aca-launcher.ts` to export `DEFAULT_ACA_JOB_POLL_INTERVAL_MS = 5000`, use that shared default in `pollUntilComplete(...)`, and parse execution responses into explicit states (`empty`, `invalid-json`, `missing-status`, `status`). The poll loop still treats only `succeeded` and `failed` as terminal and still returns `timed-out` from the same elapsed/remaining math, so the executor’s `remote runtime` boundary and downstream six-phase normalization did not move. I added debug-level poll diagnostics for REST failures, fetch failures, malformed payloads, unknown statuses, and attempt/terminal logs with `pollIntervalMs` so operators can see the faster cadence and drift without promoting these retries to warn-level noise.

I aligned `scripts/test-aca-job.ts` to the same exported cadence constant so the smoke path exercises the same contract as production. I did not need to change `src/execution/executor.test.ts`; the existing executor-facing ACA dispatch tests already proved the continuity requirements, so I re-ran them as the verification bar instead of mutating stable coverage. I also recorded decision D108 for the shared 5s cadence/debug-drift choice and added a knowledge note that mixed explicit Bun test paths can hide a missing file if other paths still match.

## Verification

Verified the task-level contract with `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/executor.test.ts` and `bun run tsc --noEmit`; both passed after the refactor. Re-ran the broader S02 slice test suite from the slice plan and it passed, including the unchanged executor/handler continuity surfaces. Attempted the slice’s `verify:m048:s02` command as instructed; it currently fails because the package script does not exist yet, so slice-level live comparison verification remains partial for this intermediate task. The passing executor tests confirm phase names and timeout/error handling did not drift while the new launcher tests confirm the 5s default cadence, retry handling, malformed-response diagnostics, and truthful timeout math.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/executor.test.ts` | 0 | ✅ pass | 4800ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 9700ms |
| 3 | `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts` | 0 | ✅ pass | 4800ms |
| 4 | `bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json` | 1 | ❌ fail | 9700ms |

## Deviations

Did not edit `src/execution/executor.test.ts`; local reality already had sufficient executor-facing continuity coverage for phase names, timeout handling, and remote-runtime timing, so I verified that coverage instead of duplicating it.

## Known Issues

`bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json` currently fails with `Script not found "verify:m048:s02"`. The slice-level compare verifier and its package.json wiring are still pending later S02 work, so live compare verification is not complete yet.

## Files Created/Modified

- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `scripts/test-aca-job.ts`
- `.gsd/KNOWLEDGE.md`
- `.gsd/DECISIONS.md`

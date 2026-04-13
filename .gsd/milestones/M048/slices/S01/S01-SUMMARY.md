---
id: S01
parent: M048
milestone: M048
provides:
  - A stable latency baseline surface for S02 optimization work.
  - Truthful degraded/unavailable phase semantics that S03 can reuse for bounded or timeout review disclosure.
  - One shared `reviewOutputKey` / `deliveryId` correlation contract across GitHub-visible and Azure-visible review evidence.
requires:
  []
affects:
  - S02
  - S03
key_files:
  - src/jobs/queue.ts
  - src/execution/executor.ts
  - src/handlers/review.ts
  - src/lib/review-utils.ts
  - src/review-audit/log-analytics.ts
  - src/review-audit/phase-timing-evidence.ts
  - scripts/verify-m048-s01.ts
  - scripts/verify-m048-s01.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D104 — merge queue, handler, and executor timing seams into one correlated six-phase summary log.
  - D105 — represent publication timing on Review Details as a degraded snapshot until the final write completes.
  - D106 — query Azure by reviewOutputKey + effective deliveryId + exact phase-summary message and fail with named mismatch/payload states instead of broad matching.
  - Env-backed live verifier inputs must skip cleanly when the review key is empty instead of consuming the next CLI flag.
patterns_established:
  - One canonical six-phase review timing contract is shared across runtime logs, GitHub Review Details, and Azure-backed verification.
  - Operator verifiers should correlate live evidence with tight identity filters and report named unavailable/mismatch states instead of broad or false-green matches.
  - Env-backed operational verifier flags must refuse to consume a following `--flag` as a value and should surface a named skipped state when live input is absent.
observability_surfaces:
  - Structured `Review phase timing summary` completion log keyed by `deliveryId` and `reviewOutputKey`.
  - GitHub Review Details timing block with six stable phases plus total wall-clock time.
  - `bun run verify:m048:s01 -- --review-output-key <key> --json` human/JSON verifier output.
  - Azure Log Analytics query path filtered by exact phase-summary message plus correlation ids.
drill_down_paths:
  - .gsd/milestones/M048/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M048/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M048/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-13T00:24:30.407Z
blocker_discovered: false
---

# S01: Live Phase Timing and Operator Evidence Surfaces

**Delivered one canonical six-phase review timing contract across queue/executor/handler seams, surfaced it on GitHub Review Details, and shipped the Azure-backed `verify:m048:s01` operator verifier with automation-safe empty-key handling.**

## What Happened

## Delivered

S01 established one shared latency-evidence contract for the real PR review path instead of leaving timing spread across unrelated logs. Queue wait metadata now flows out of `src/jobs/queue.ts`, executor handoff/runtime timing comes back from `src/execution/executor.ts`, and `src/handlers/review.ts` merges those seams with local orchestration timing into one correlated `Review phase timing summary` payload keyed by `deliveryId` and `reviewOutputKey`.

That same six-phase contract is now exposed on the two operator-facing surfaces that matter for M048. `src/lib/review-utils.ts` renders queue wait, workspace preparation, retrieval/context assembly, executor handoff, remote runtime, and publication in a stable Review Details block with explicit degraded/unavailable wording instead of invented zeroes. `scripts/verify-m048-s01.ts` and `src/review-audit/phase-timing-evidence.ts` query Azure Log Analytics for the same contract, normalize duplicate/drifted rows, and emit named `ok` / `no matching` / `correlation mismatch` / `invalid payload` outcomes so later slices can measure latency changes without guessing.

Closeout also fixed one automation-only verifier trap: when `REVIEW_OUTPUT_KEY` is unset, the CLI no longer consumes `--json` as the review key and reports a misleading invalid-correlation failure. It now returns the named skipped status `m048_s01_skipped_missing_review_output_key` and avoids running a broad live query, while preserving fail-loud behavior when a real `reviewOutputKey` is supplied and the live evidence is missing or drifted.

## What downstream slices get

- S02 now has a stable per-phase baseline for queue, workspace, retrieval, executor handoff, remote runtime, and publication latency.
- S03 can reuse the same degraded/unavailable timing semantics when bounded or timeout review paths need to stay truthful.
- Future operators can correlate Review Details and Azure evidence with the same `reviewOutputKey` / `deliveryId` pair instead of reconstructing timing from ad hoc logs.

## Operational Readiness (Q8)

- **Health signal:** a real `xbmc/kodiai` review emits a `Review phase timing summary` row, Review Details shows all six phases in order, and `bun run verify:m048:s01 -- --review-output-key <live-key> --json` returns `status_code: m048_s01_ok` with the same correlation ids.
- **Failure signal:** the verifier reports `m048_s01_no_matching_phase_timing`, `m048_s01_correlation_mismatch`, `m048_s01_invalid_phase_payload`, or `m048_s01_skipped_missing_review_output_key`; Review Details is missing the timing block; or Azure has review publication logs but no phase-summary rows.
- **Recovery procedure:** deploy the M048/S01 code, trigger a fresh real `xbmc/kodiai` review, capture the new `reviewOutputKey`, rerun `verify:m048:s01` with that key, and inspect Azure rows plus Review Details together if correlation still fails.
- **Monitoring gaps:** there is not yet an automated alert for "new deployed reviews are publishing but phase-summary rows are absent," so missing phase logs are currently detected only through the verifier/no-match path and manual Azure inspection.


## Verification

- `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts` — passed fresh with 146 tests green.
- `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` — passed fresh in automation with `status_code: m048_s01_skipped_missing_review_output_key`, confirming the verifier now handles an empty env-backed key truthfully instead of misparsing `--json` as the key.
- `bun run tsc --noEmit` — passed fresh.
- Azure Log Analytics workspace discovery/query path was exercised against `rg-kodiai`; no deployed `Review phase timing summary` rows were present yet, so live end-to-end latency proof remains a post-deploy verification step rather than a code regression.

## Requirements Advanced

- R050 — Implemented the six-phase timing capture, Review Details rendering, Azure evidence normalizer, and operator verifier surfaces; live production validation remains pending deploy plus a fresh review run.

## Requirements Validated

None.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Closeout added one verifier hardening change that was not called out in the original task breakdown: explicit empty env-backed `--review-output-key` input now yields the named skipped status `m048_s01_skipped_missing_review_output_key` instead of consuming the following flag as the key and producing a misleading invalid-correlation failure.

## Known Limitations

Live end-to-end proof is still pending deployment plus a fresh real `xbmc/kodiai` review that emits the new structured `Review phase timing summary` rows. Fresh Azure workspace queries showed no deployed phase-summary rows yet, so R050 is advanced but not validated in production.

## Follow-ups

Deploy the current M048/S01 code, trigger a fresh real review, rerun `bun run verify:m048:s01 -- --review-output-key <live-key> --json`, and only then mark R050 validated. S02 should use the shared six-phase surfaces as its latency baseline instead of introducing parallel measurement paths.

## Files Created/Modified

- `src/jobs/types.ts` — Added queue timing metadata contract used by the review handler.
- `src/jobs/queue.ts` — Propagated structured queue wait metadata into queued review jobs.
- `src/execution/types.ts` — Defined shared review/executor phase timing types.
- `src/execution/executor.ts` — Returned executor handoff/runtime phase timing data for success, failure, timeout, and degraded paths.
- `src/handlers/review.ts` — Merged queue/local/executor timings, emitted the structured phase summary log, and threaded phase timing into Review Details.
- `src/lib/review-utils.ts` — Rendered the stable six-phase Review Details timing block.
- `src/review-audit/log-analytics.ts` — Added exact message filtering and normalized Azure row handling for review audit queries.
- `src/review-audit/phase-timing-evidence.ts` — Normalized Azure phase-timing rows into one correlated evidence report with named mismatch/payload states.
- `scripts/verify-m048-s01.ts` — Shipped the operator verifier and hardened empty env-backed key handling so automation skips cleanly instead of misparsing the next flag.
- `scripts/verify-m048-s01.test.ts` — Added regression coverage for empty review-output-key parsing and skipped verifier behavior.
- `.gsd/KNOWLEDGE.md` — Recorded the env-backed verifier parsing/skip rule for future live proof scripts.

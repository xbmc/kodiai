---
id: S01
parent: M044
milestone: M044
provides:
  - Shared `reviewOutputKey` parsing and extraction helpers for later audit/reporting work
  - A deterministic lane-stratified GitHub sample of recent xbmc/xbmc Kodiai-reviewed PRs
  - A provisional verdict engine and live S01 verifier showing where evidence is missing versus contradictory
requires:
  []
affects:
  - S02
  - S03
key_files:
  - src/handlers/review-idempotency.ts
  - src/handlers/review-idempotency.test.ts
  - src/review-audit/recent-review-sample.ts
  - src/review-audit/recent-review-sample.test.ts
  - src/review-audit/evidence-correlation.ts
  - src/review-audit/evidence-correlation.test.ts
  - scripts/verify-m044-s01.ts
  - scripts/verify-m044-s01.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D056 — lane-stratified recent-sample rule
  - D057 — single `verify:m044`-style operator CLI direction
  - D058 — shared `reviewOutputKey` parser/normalizer
  - D059 — explicit reviews without publish-resolution proof remain `indeterminate` in S01
patterns_established:
  - Audit collectors must parse both `kodiai:review-output-key` and `kodiai:review-details` markers to avoid silently dropping clean automatic reviews.
  - Retry-suffixed review-output keys must be normalized into base key + retry attempt + effective delivery ID before correlating backend evidence.
  - Operator verifiers should fail open on unavailable secondary evidence sources and emit explicit availability states instead of aborting the primary audit surface.
observability_surfaces:
  - `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json`
  - Per-PR JSON evidence records with lane, source, reviewOutputKey, verdict, rationale, and source availability
  - Selection metadata showing scanned PR count, collected artifact count, lane counts, and fill count
drill_down_paths:
  - .gsd/milestones/M044/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M044/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M044/slices/S01/tasks/T03-SUMMARY.md
  - .gsd/milestones/M044/slices/S01/tasks/T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-09T07:59:05.130Z
blocker_discovered: false
---

# S01: Sample Selection and Recent Review Audit

**Shipped the first live recent-review audit seam, including parser, collector, provisional classifier, and a working `verify:m044:s01` command over real xbmc/xbmc history.**

## What Happened

S01 turned the M044 audit from a roadmap idea into a real working seam. The slice added shared parsing and extraction for review-output identity, including retry-suffixed keys and the separate `kodiai:review-details` marker used by clean automatic reviews. On top of that it built a GitHub-visible collector that scans the same three Kodiai output surfaces already trusted by the runtime, keeps the latest valid artifact per PR, and applies the lane-stratified sample rule deterministically. The slice then added lane-aware internal evidence correlation: automatic reviews can be matched to durable `reviews`, `findings`, `review_checkpoints`, and `telemetry_events` rows by effective delivery identity, while explicit reviews stay explicitly `indeterminate` when publish-resolution evidence is not yet available. Finally, S01 shipped `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json` and exercised it live against `xbmc/xbmc`. The live run scanned 96 recent PRs, collected 67 Kodiai artifacts, and selected a 12-PR sample (10 automatic, 2 explicit). It also surfaced the first real operational gap cleanly: GitHub access worked, but DB-backed evidence timed out, so the verifier now reports `databaseAccess=unavailable` and preserves the GitHub sample instead of aborting.

## Verification

`bun test ./src/handlers/review-idempotency.test.ts ./src/review-audit/recent-review-sample.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m044-s01.test.ts` passed (27 tests, 0 failures). `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json` then completed with `status_code=m044_s01_ok`, `githubAccess=available`, `databaseAccess=unavailable`, `scannedPullRequests=96`, `collectedArtifacts=67`, and a 12-PR sample.

## Requirements Advanced

- R045 — S01 established the real audit substrate for R045: deterministic recent sampling from live GitHub-visible Kodiai output, structured per-PR evidence envelopes, truthful `indeterminate` handling, and a working `verify:m044:s01` command over real xbmc/xbmc history.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

The first live verifier run surfaced an environment gap rather than a code defect: the configured PostgreSQL host timed out. Instead of treating that as an external blocker, S01 expanded the verifier to fail open on DB-backed evidence and report `databaseAccess=unavailable` so the GitHub sample could still be audited truthfully.

## Known Limitations

The live S01 verifier could reach GitHub but not the configured PostgreSQL instance, so automatic-lane cases currently degrade to `indeterminate` with `databaseAccess=unavailable`. Explicit mention-review cases also remain `indeterminate` because publish-resolution evidence has not yet been wired into the codebase.

## Follow-ups

S02 must decide whether the next real gap is environment/durability hardening or review-publication logic. Two concrete gaps remain visible after S01: (1) automatic-lane durable DB evidence is unreachable from the current environment, and (2) explicit-lane publish-resolution truth is still log-backed and therefore unresolved in the verifier.

## Files Created/Modified

- `src/handlers/review-idempotency.ts` — Added shared review-output key parsing, retry normalization, and extraction of both review-output and review-details marker shapes.
- `src/handlers/review-idempotency.test.ts` — Added regression coverage for base-key parsing, retry suffix handling, malformed keys, and review-details marker extraction.
- `src/review-audit/recent-review-sample.ts` — Added the GitHub-visible artifact collector and deterministic lane-stratified sample selector for recent review auditing.
- `src/review-audit/recent-review-sample.test.ts` — Added collector/selector tests covering lane classification, latest-valid-artifact selection, clean-review details comments, and fill-by-recency behavior.
- `src/review-audit/evidence-correlation.ts` — Added automatic-lane durable evidence loading and provisional verdict classification across clean, published, suspicious, failure-shaped, and indeterminate outcomes.
- `src/review-audit/evidence-correlation.test.ts` — Added evidence-correlation tests covering retry delivery matching, automatic-lane verdicts, and explicit indeterminate / publish-failure paths.
- `scripts/verify-m044-s01.ts` — Added the first live audit CLI with preflight reporting, JSON/human output, and fail-open DB handling for the S01 sample run.
- `scripts/verify-m044-s01.test.ts` — Added the verifier test contract for CLI parsing, successful provisional audit evaluation, DB fail-open behavior, and missing-GitHub preflight output.
- `package.json` — Registered the new `verify:m044:s01` package script.
- `.gsd/KNOWLEDGE.md` — Recorded non-obvious retry and review-details marker rules for future audit work.

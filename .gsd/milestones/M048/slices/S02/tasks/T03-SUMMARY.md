---
id: T03
parent: S02
milestone: M048
key_files:
  - scripts/verify-m048-s01.ts
  - scripts/verify-m048-s02.ts
  - scripts/verify-m048-s02.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
  - .gsd/DECISIONS.md
key_decisions:
  - D109 — embed the full S01 verifier reports inside `verify:m048:s02`, compare only the targeted latency phases (`workspace preparation`, `executor handoff`, `remote runtime`), and evaluate publication continuity separately so faster runtime does not hide publication regressions.
duration: 
verification_result: mixed
completed_at: 2026-04-13T01:37:26.564Z
blocker_discovered: false
---

# T03: Added the M048 S02 review-latency compare verifier with targeted phase deltas, publication continuity reporting, and deterministic CLI coverage.

**Added the M048 S02 review-latency compare verifier with targeted phase deltas, publication continuity reporting, and deterministic CLI coverage.**

## What Happened

I wrote `scripts/verify-m048-s02.test.ts` first, confirmed it failed because the compare script and package wiring did not exist, and then implemented the smallest shipped surface that satisfied that contract. `scripts/verify-m048-s01.ts` now exports the shared formatting/workspace helpers the compare path reuses, and the new `scripts/verify-m048-s02.ts` parses baseline/candidate review keys with side-specific delivery-id validation, evaluates both reviews through the existing S01 evidence pipeline, and emits one operator-facing report with targeted latency deltas plus publication continuity state. The compare report keeps the full embedded S01 reports for both sides so Azure availability, invalid-payload states, and no-match outcomes stay visible instead of being flattened into a second contract. I wired `verify:m048:s02` into `package.json`, added deterministic coverage for improved, no-improvement, inconclusive, publication-regressed, and invalid-arg paths, recorded D109 for the report shape, and appended a knowledge entry about the verifier’s bounded 14-day evidence window.

For verification, the focused verifier test suite passed, the broader S02 slice regression bundle passed, and `bun run tsc --noEmit` passed. The env-backed live compare invocation failed initially because the expected review-key env vars were unset in automation, so I recovered fresh real review keys from Azure review-output evidence and reran the compare command against those real keys. That run exercised the shipped command shape and produced the truthful degraded-path result: both sides returned `m048_s01_no_matching_phase_timing`, the top-level compare report returned `m048_s02_inconclusive`, and the missing phase evidence stayed explicit instead of being misreported as a successful before/after latency proof.

## Verification

Verified the new compare command in three layers. First, `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts` passed and proved the compare-report happy path, no-improvement path, inconclusive/error handling, publication-regression reporting, and invalid CLI arg behavior while keeping the original S01 verifier contract green. Second, the broader S02 regression bundle (`aca-launcher`, workspace transport, agent entrypoint, executor, review handler, and both verifier suites) passed, confirming the new compare script did not regress the queue/executor/review latency surfaces touched earlier in the slice. Third, `bun run tsc --noEmit` passed cleanly. For the live proof surface, I ran `verify:m048:s02` against fresh real review keys recovered from Azure review-output logs inside the verifier’s 14-day window; the command executed and returned the expected truthful degraded result (`m048_s02_inconclusive`) because production still lacks matching `Review phase timing summary` rows for those keys.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts` | 0 | ✅ pass | 39ms |
| 2 | `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts` | 0 | ✅ pass | 17000ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 8477ms |
| 4 | `bun run verify:m048:s02 -- --baseline-review-output-key 'kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28103:action-opened:delivery-a8e96f30-2c81-11f1-8669-73fd6f5bfd79:head-bd35dbaa518ab3c20b9483f171575d2966949a29' --candidate-review-output-key 'kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28105:action-opened:delivery-f920ed00-2d0f-11f1-8f64-ae41dd9c851e:head-1e70ebe7e09c67926ecd931195dbe4a1263c9dfa' --json` | 1 | ❌ fail | 6470ms |

## Deviations

The planned env-backed live invocation could not run as written because `BASELINE_REVIEW_OUTPUT_KEY` and `REVIEW_OUTPUT_KEY` were unset in this automation environment. To keep the proof path truthful, I recovered fresh real review keys from Azure `reviewOutputKey` logs inside the verifier’s fixed 14-day window and used those for the live compare run instead.

## Known Issues

Current Azure workspaces still expose fresh `reviewOutputKey` publication evidence but no matching `Review phase timing summary` rows for recent 14-day review keys, so the live compare command now runs truthfully but remains `m048_s02_inconclusive` until post-deploy reviews emit the new structured phase-timing log in production.

## Files Created/Modified

- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s02.ts`
- `scripts/verify-m048-s02.test.ts`
- `package.json`
- `.gsd/KNOWLEDGE.md`
- `.gsd/DECISIONS.md`

---
id: T02
parent: S01
milestone: M038
key_files:
  - src/structural-impact/orchestrator.ts
  - src/structural-impact/orchestrator.test.ts
key_decisions:
  - Adapter rejections caught inside orchestrator (.catch → Error value) so withTimeout never sees unhandled rejection
  - Promise.all concurrent execution: neither adapter stalls the other
  - Cache write-through on both ok and partial results to avoid hammering down substrates on retry
  - onSignal observer errors swallowed unconditionally — observer crashes cannot affect review pipeline
  - TIMEOUT_SENTINEL is module-local Symbol to distinguish genuine null from timeout without leaking
duration: 
verification_result: passed
completed_at: 2026-04-05T17:02:53.287Z
blocker_discovered: false
---

# T02: Built fetchStructuralImpact orchestrator with concurrent adapter execution, per-adapter timeout, write-through cache, and 12-event onSignal observability — 25 tests passing, tsc clean

**Built fetchStructuralImpact orchestrator with concurrent adapter execution, per-adapter timeout, write-through cache, and 12-event onSignal observability — 25 tests passing, tsc clean**

## What Happened

Created src/structural-impact/orchestrator.ts with fetchStructuralImpact as the single orchestration entry point. Runs GraphAdapter and CorpusAdapter concurrently via Promise.all([withTimeout(graph), withTimeout(corpus)]) so neither adapter stalls the other. Adapter rejections are caught before entering withTimeout (.catch → Error value) so Promise.race never sees an unhandled rejection — this was discovered as a failure during initial testing. Timeout (30s default per M038 spec) produces a TIMEOUT_SENTINEL that becomes a degradation record. Both ok and partial results are written to cache keyed on (repo, baseSha, headSha); buildStructuralImpactCacheKey provides the canonical key. onSignal callback emits 12 typed signals (cache-hit, cache-miss, cache-write, graph-ok/timeout/error, corpus-ok/timeout/error, result-ok/partial/unavailable) with elapsedMs and optional detail. Observer errors are swallowed by emit() so a crashed logger never affects the review pipeline. The orchestrator calls boundStructuralImpactPayload from T01 for final assembly — no direct type imports from substrate modules.

## Verification

bun test ./src/structural-impact/orchestrator.test.ts → 25 pass, 0 fail (348ms). bun run tsc --noEmit → clean exit 0. Tests cover: happy path, graph timeout, corpus timeout, both timeout, graph error, corpus error, both error, cache hit/miss/write, partial cached, no-cache no-error, all signal kinds with elapsedMs and detail, observer crash swallowed, concurrent execution timing.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/structural-impact/orchestrator.test.ts` | 0 | ✅ pass | 348ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 900ms |

## Deviations

withTimeout propagates Promise rejections through Promise.race — adapter calls must be wrapped in .catch before passing to withTimeout. Fixed by adding reject-catch wrappers inside fetchStructuralImpact. The adapter interface contract from T01 is unchanged.

## Known Issues

None.

## Files Created/Modified

- `src/structural-impact/orchestrator.ts`
- `src/structural-impact/orchestrator.test.ts`

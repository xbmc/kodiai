---
id: S03
parent: M038
milestone: M038
provides:
  - Hardened structural-impact consumer path: repeated reviews reuse cached results (no redundant substrate calls within TTL).
  - Bounded substrate failure modes: timeout → unavailable+elapsed proof; throw → unavailable+no-invented-evidence; one-source-fail → partial+only-available-evidence.
  - summarizeStructuralImpactDegradation() as the canonical availability/truthfulness classifier for downstream use.
  - Four-check machine-verifiable proof harness (verify-m038-s03.ts) that closes M038's operational verification contract.
  - R038 validated: breaking-change detection is structurally grounded and fail-open across all tested substrate failure modes.
requires:
  - slice: S01
    provides: fetchStructuralImpact() orchestrator, GraphAdapter/CorpusAdapter seams, StructuralImpactPayload/StructuralImpactDegradation types, StructuralImpactCache injection point
  - slice: S02
    provides: review handler structural-impact wiring, review-integration adapter wiring, structural-impact-formatter, Review Details and prompt rendering surfaces
affects:
  []
key_files:
  - src/structural-impact/cache.ts
  - src/structural-impact/cache.test.ts
  - src/structural-impact/degradation.ts
  - src/structural-impact/degradation.test.ts
  - src/structural-impact/orchestrator.ts
  - src/structural-impact/review-integration.ts
  - src/lib/structural-impact-formatter.ts
  - src/lib/review-utils.ts
  - src/handlers/review.ts
  - scripts/verify-m038-s03.ts
  - scripts/verify-m038-s03.test.ts
  - package.json
key_decisions:
  - Extracted structural-impact cache keying and storage into a dedicated cache module backed by the shared in-memory cache primitive instead of keeping cache policy embedded inside the orchestrator.
  - Cache is injected at handler level (not constructed inside the orchestrator) so each handler owns its cache lifecycle and tests can inject isolated or custom-clocked caches.
  - Partial (timeout-degraded) payloads are cached truthfully — a second call on the same key returns the degraded result rather than re-querying, avoiding thundering-herd on flaky substrates.
  - Centralized structural-impact truthfulness and fallback classification in a dedicated degradation helper (degradation.ts) rather than duplicating partial/unavailable logic across the formatter and review handler.
  - Each verifier check is independently exported so tests can assert pass/fail per check without running the full harness.
  - The timeout check uses a 40ms cutoff against 500ms slow adapters and asserts elapsed < 400ms for generous CI margin.
  - The partial degradation check covers both asymmetric failure orientations (graph-ok+corpus-fail and graph-fail+corpus-ok) in a single check.
patterns_established:
  - Handler-level cache injection: create cache at handler startup, inject into each orchestrator call, never construct inside the orchestrator.
  - Degradation normalizer pattern: single function derives all availability/truthfulness signals from raw degradation records; formatter and handler use the summary, not raw payload fields, as the rendering gate.
  - Asymmetric partial-degradation coverage: cover both failure orientations in one verifier check with labeled case prefixes in the detail string (case1[graphOk+corpusFail]: ... | case2[graphFail+corpusOk]: ...).
observability_surfaces:
  - summarizeStructuralImpactDegradation() truthfulnessSignals array: machine-readable set of signals (graph-unavailable, corpus-unavailable, graph-empty, corpus-empty, no-structural-evidence) emitted for every review — loggable by the handler for structured observability.
  - Orchestrator onSignal callback: cache-hit, cache-miss signals already wired in orchestrator.ts (established S01); S03 adds cache module that the signals refer to.
  - verify-m038-s03.ts --json output: stable machine-readable proof record suitable for CI assertion or dashboard integration.
drill_down_paths:
  - .gsd/milestones/M038/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M038/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M038/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T21:12:56.944Z
blocker_discovered: false
---

# S03: Timeout, Cache Reuse, and Fail-Open Verification

**Hardened the structural-impact consumer path with dedicated cache reuse, explicit timeout enforcement, truthful fail-open degradation, and a four-check machine-verifiable proof harness — all 61 structural-impact tests pass and verify:m038:s03 --json exits 0 with overallPassed:true.**

## What Happened

S03 added the final hardening layer to the M038 structural-impact consumer path across three focused tasks.

**T01 — Cache Extraction and Reuse**
Extracted structural-impact caching from inline orchestrator logic into a dedicated `src/structural-impact/cache.ts` module. The module provides `createStructuralImpactCache()` (256-entry LRU, 10-minute TTL, injectable clock for tests) and `buildStructuralImpactCacheKey()` which lowercases the repo for stable keying. The review handler (`src/handlers/review.ts`) now creates a handler-level cache instance at startup and injects it into each `fetchReviewStructuralImpact()` call. Partial (timeout-degraded) payloads are cached truthfully so a second call for the same (repo, baseSha, headSha) triple returns the degraded result without re-querying. Tests cover canonical keying, TTL expiry, bounded LRU eviction, and truthful reuse of partial payloads. Affected imports in `orchestrator.test.ts` and `review-integration.test.ts` were repaired to use the new module.

**T02 — Degradation Normalizer**
Added `src/structural-impact/degradation.ts` as the single source of truth for availability and truthfulness classification. `summarizeStructuralImpactDegradation(payload)` derives `graphAvailable`, `corpusAvailable`, `fallbackUsed`, `hasRenderableEvidence`, and a `truthfulnessSignals` array from the raw degradation records. It overrides the raw `payload.status` to force `partial` whenever any degradation record exists and `unavailable` when both sources degraded — preventing the formatter or handler from ever claiming `ok` while evidence is actually missing. The formatter (`src/lib/structural-impact-formatter.ts`), review integration (`src/structural-impact/review-integration.ts`), and review handler (`src/handlers/review.ts`) were updated to use the degradation summary as the rendering gate. `src/lib/review-utils.ts` was also touched to thread degradation metadata through the Review Details summary path.

**T03 — Milestone-Level Verifier**
Implemented `scripts/verify-m038-s03.ts` as a self-contained in-process proof harness with four independently-exported checks and registered the `verify:m038:s03` npm script. The checks use call-counting adapters and injected caches/clocks rather than live I/O:

1. **M038-S03-CACHE-REUSE** — Instruments `fetchStructuralImpact` with call-counting adapters. First call: cache-miss=true, cache-write=true, adapterCalls=2. Second call (same key): cache-hit=true, noNewAdapterCalls=true, status matches. Even injects broken replacement adapters to prove they are never invoked on a hit.
2. **M038-S03-TIMEOUT-FAIL-OPEN** — Both adapters return 500ms latency against a 40ms timeout. Asserts: status=unavailable, degs=2, both timeout signals present, elapsed<400ms (generous CI margin), changedFiles preserved, no invented callers/evidence, fallbackUsed=true, hasNoRenderableEvidence=true.
3. **M038-S03-SUBSTRATE-FAILURE-TRUTHFUL** — Both adapters throw. Asserts: status=unavailable, graphStats=null, empty callers/evidence/impactedFiles/tests, degradation summary truthfulnessSignals=[graph-unavailable, corpus-unavailable, no-structural-evidence].
4. **M038-S03-PARTIAL-DEGRADATION-TRUTHFUL** — Covers both asymmetric failure orientations in one check. case1[graph-ok+corpus-fail]: status=partial, hasGraphEvidence=true, noCorpusEvidence=true, onlyCorpusDeg=true, hasRenderableEvidence=true. case2[graph-fail+corpus-ok]: status=partial, hasCorpusEvidence=true, noGraphEvidence=true, onlyGraphDeg=true, hasRenderableEvidence=true.

`scripts/verify-m038-s03.test.ts` adds 11 tests covering per-check pass/fail, full harness evaluation, JSON round-trip, human-readable output, and stderr failure output.

## Verification

All slice-plan verification commands passed:

1. `bun test ./src/structural-impact/cache.test.ts` — exit 0, 4/4 pass (canonical keying, TTL expiry, LRU eviction, partial payload reuse)
2. `bun test ./src/structural-impact/degradation.test.ts` — exit 0, 4/4 pass
3. `bun test ./scripts/verify-m038-s03.test.ts` — exit 0, 11/11 pass
4. `bun run verify:m038:s03 -- --json` — exit 0, overallPassed:true, all 4 checks pass with stable status codes (cache_reuse_verified, timeout_fail_open_verified, substrate_failure_truthful_verified, partial_degradation_truthful_verified)
5. `bun run tsc --noEmit` — exit 0, no output
6. `bun test ./src/structural-impact/` — exit 0, 61/61 pass across all 5 structural-impact test files

## Requirements Advanced

- R038 — Four-check verifier proves the full fail-open contract: cache reuse, timeout graceful degradation, complete substrate failure (no invented evidence), and asymmetric partial degradation — all with stable machine-readable status codes and overallPassed:true.

## Requirements Validated

- R038 — bun run verify:m038:s03 --json exits 0 with overallPassed:true. All four checks pass: CACHE-REUSE (cache_reuse_verified), TIMEOUT-FAIL-OPEN (timeout_fail_open_verified), SUBSTRATE-FAILURE-TRUTHFUL (substrate_failure_truthful_verified), PARTIAL-DEGRADATION-TRUTHFUL (partial_degradation_truthful_verified). 61/61 structural-impact tests pass. tsc --noEmit exits 0.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

The structural-impact cache is process-local and in-memory only. Cross-process or persisted reuse is not implemented — each handler restart begins with an empty cache. The 10-minute TTL is the only eviction mechanism in steady-state (plus LRU at 256 entries). For high-throughput deployments with many concurrent processes this means repeated substrate calls per process rather than globally deduplicated; this was out of scope for S03.

## Follow-ups

None blocking for M038 closure. Future: if the structural-impact consumer path is extended to more review paths (e.g., incremental review or issue triage), the cache module and degradation normalizer are ready to be consumed without changes.

## Files Created/Modified

- `src/structural-impact/cache.ts` — New: dedicated cache module with createStructuralImpactCache() factory and buildStructuralImpactCacheKey()
- `src/structural-impact/cache.test.ts` — New: 4 tests for canonical keying, TTL expiry, LRU eviction, partial payload reuse
- `src/structural-impact/degradation.ts` — New: summarizeStructuralImpactDegradation() single-source-of-truth for availability/truthfulness classification
- `src/structural-impact/degradation.test.ts` — New: 4 tests for status override logic and truthfulness signal emission
- `src/structural-impact/orchestrator.ts` — Modified: accept injected StructuralImpactCache, emit cache-hit/cache-miss signals
- `src/structural-impact/review-integration.ts` — Modified: accept and thread cache through to orchestrator; use degradation summary for reviewer-facing status
- `src/lib/structural-impact-formatter.ts` — Modified: use degradation summary availability flags as rendering gate
- `src/lib/review-utils.ts` — Modified: thread degradation summary through Review Details summary path
- `src/handlers/review.ts` — Modified: create handler-level StructuralImpactCache at startup, inject into each fetchReviewStructuralImpact call
- `src/structural-impact/orchestrator.test.ts` — Modified: updated imports to use new cache module
- `src/structural-impact/review-integration.test.ts` — Modified: updated imports; added cache-reuse and timeout tests
- `src/lib/structural-impact-formatter.test.ts` — Modified: added degradation-aware rendering tests
- `scripts/verify-m038-s03.ts` — New: four-check in-process proof harness (CACHE-REUSE, TIMEOUT-FAIL-OPEN, SUBSTRATE-FAILURE-TRUTHFUL, PARTIAL-DEGRADATION-TRUTHFUL)
- `scripts/verify-m038-s03.test.ts` — New: 11 tests for per-check pass/fail, full harness, JSON round-trip, human-readable output, stderr failure
- `package.json` — Modified: added verify:m038:s03 npm script

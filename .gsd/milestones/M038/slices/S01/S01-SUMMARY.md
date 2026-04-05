---
id: S01
parent: M038
milestone: M038
provides:
  - A single module boundary for all structural-impact fetching from review code.
  - A bounded StructuralImpactPayload contract ready for Structural Impact section rendering in S02.
  - Fail-open timeout, degradation, and cache semantics ready for S03 reuse and verification.
  - Review-path substrate wiring that no longer requires direct graph-substrate calls in review.ts for large-PR selection.
requires:
  - slice: M040/S02
    provides: ReviewGraphBlastRadiusResult/queryBlastRadius output and graph-aware ranking inputs consumed through the GraphAdapter seam.
  - slice: M041/S02
    provides: searchCanonicalCode() canonical current-code retrieval with canonical ref and commit provenance consumed through the CorpusAdapter seam.
affects:
  - M038/S02
  - M038/S03
key_files:
  - src/structural-impact/types.ts
  - src/structural-impact/adapters.ts
  - src/structural-impact/adapters.test.ts
  - src/structural-impact/orchestrator.ts
  - src/structural-impact/orchestrator.test.ts
  - src/structural-impact/review-integration.ts
  - src/structural-impact/review-integration.test.ts
  - src/handlers/review.ts
  - .gsd/milestones/M038/slices/S01/S01-SUMMARY.md
  - .gsd/milestones/M038/slices/S01/S01-UAT.md
  - .gsd/PROJECT.md
key_decisions:
  - Define graph/corpus adapter contracts locally in src/structural-impact instead of importing substrate result types directly, keeping M040/M041 changes bounded to one wiring seam.
  - Use a three-state structural-impact status contract (ok/partial/unavailable) so downstream formatters can distinguish complete, degraded, and absent evidence cleanly.
  - Cache partial as well as full structural-impact results to avoid repeatedly hammering slow or failing substrates during the same review scope.
  - Preserve the existing review prompt contract temporarily by returning both the bounded payload and captured raw graphBlastRadius from the review integration seam.
patterns_established:
  - Consumer-adapter seam pattern: mirror only the substrate fields the consumer needs in local types, inject concrete implementations at the integration boundary, and keep review handlers unaware of substrate internals.
  - Bounded assembly-first pattern: normalize graph and corpus outputs into one bounded payload before any prompt or review rendering logic runs.
  - Concurrent fail-open orchestration pattern: run both substrate calls in parallel, catch adapter rejections before timeout racing, and return degradations/partial payloads instead of throwing.
  - Observer-safe telemetry pattern: emit structured orchestration signals but swallow observer failures so logging/metrics code cannot break review execution.
  - Incremental migration seam pattern: temporarily return both new bounded payloads and legacy raw structures when downstream code still depends on the legacy contract.
observability_surfaces:
  - fetchStructuralImpact() emits 12 structured signal kinds covering cache-hit/cache-miss/cache-write, graph ok/timeout/error, corpus ok/timeout/error, and result ok/partial/unavailable.
  - Signals carry elapsedMs and optional detail for timeout/error/cache attribution.
  - StructuralImpactPayload.graphStats includes changedFilesRequested so downstream consumers can frame graph coverage against requested changed files.
  - buildStructuralImpactCacheKey(repo, baseSha, headSha) provides stable review-scoped cache identity for reuse and verification.
drill_down_paths:
  - .gsd/milestones/M038/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M038/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M038/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T19:19:28.318Z
blocker_discovered: false
---

# S01: Graph/Corpus Consumer Adapters and Orchestration

**Built the consumer-facing structural-impact contract and orchestration layer that lets M038 consume M040 graph blast-radius data and M041 canonical current-code evidence through explicit adapters, with bounded results, timeout/degradation handling, cache reuse, and a single review-path integration seam.**

## What Happened

S01 established the first consumer-side layer for M038 without leaking substrate internals into the review handler. T01 created src/structural-impact/types.ts and src/structural-impact/adapters.ts, defining a bounded StructuralImpactPayload contract plus local GraphAdapter and CorpusAdapter seams that mirror only the M040/M041 fields M038 needs. The assembly boundary translates graph blast-radius and canonical current-code matches into one bounded payload and adds graphStats.changedFilesRequested so downstream consumers can frame graph coverage versus requested changed files. T02 added src/structural-impact/orchestrator.ts with fetchStructuralImpact(), which runs graph and corpus calls concurrently, applies per-adapter timeout handling, converts failures/timeouts into degradation records, caches partial as well as full results, and emits a 12-signal onSignal observability stream. T03 added src/structural-impact/review-integration.ts and rewired src/handlers/review.ts so the large-PR graph-aware selection path now goes through fetchReviewStructuralImpact() instead of calling the graph substrate directly. The review seam intentionally returns both the bounded payload and captured raw graphBlastRadius so the handler can migrate incrementally: review.ts stops reaching into substrate wiring directly now, while later slices can adopt the bounded payload for user-visible rendering and prompt assembly.

## Verification

Ran all slice-plan verification commands and a slice-wide typecheck: bun test ./src/structural-impact/adapters.test.ts (18 pass, 0 fail); bun test ./src/structural-impact/orchestrator.test.ts (25 pass, 0 fail); bun test ./src/structural-impact/review-integration.test.ts (9 pass, 0 fail); bun run tsc --noEmit (exit 0, clean). Additional code-path inspection confirmed src/handlers/review.ts now calls fetchReviewStructuralImpact() and only applies applyGraphAwareSelection() when captured graphBlastRadius is present.

## Requirements Advanced

- R037 — S01 established the bounded consumer contract and orchestration layer that combines M040 graph blast-radius data with M041 canonical current-code retrieval behind explicit adapters, enabling M038 to produce an internal structural-impact payload for changed C++/Python review inputs.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

M040's probableDependents is renamed to probableCallers in the bounded consumer payload for clearer downstream review semantics, while the adapter mirror type preserves the raw substrate field name. The review integration seam also returns both the bounded payload and raw graphBlastRadius so review.ts can migrate incrementally without changing the existing prompt contract in this slice.

## Known Limitations

review.ts now uses the review-facing seam for graph-aware file selection, but it does not yet consume payload.canonicalEvidence or the bounded StructuralImpactPayload for Review Details/prompt rendering; that remains S02 work. The orchestration cache contract and stable cache key exist, but the current review wiring does not yet inject a production cache implementation. onSignal observability is implemented and tested, but no production metric/dashboard sink was added in this slice.

## Follow-ups

In S02, render a bounded Structural Impact section from StructuralImpactPayload and thread canonical unchanged-code evidence into the review/prompt path. In S03, wire a concrete cache implementation and verify repeated-review reuse plus fail-open timeout behavior end to end.

## Files Created/Modified

- `src/structural-impact/types.ts` — Added bounded structural-impact payload, status, graph stats, canonical evidence, and degradation contracts.
- `src/structural-impact/adapters.ts` — Added local GraphAdapter and CorpusAdapter seams plus bounded payload assembly/translation helpers.
- `src/structural-impact/adapters.test.ts` — Added contract and translation tests for bounded payload assembly.
- `src/structural-impact/orchestrator.ts` — Added concurrent graph/corpus orchestration with timeout handling, caching, and structured signals.
- `src/structural-impact/orchestrator.test.ts` — Added tests for ok/partial/unavailable behavior, timeouts, errors, cache reuse, observability, and concurrency.
- `src/structural-impact/review-integration.ts` — Added review-facing seam that builds concrete graph/corpus adapters and returns both bounded payload and captured raw graph output.
- `src/structural-impact/review-integration.test.ts` — Added fail-open, cache, timeout, and signal-forwarding tests for the review integration seam.
- `src/handlers/review.ts` — Replaced direct graph-substrate selection call with fetchReviewStructuralImpact() in the large-PR path.
- `.gsd/milestones/M038/slices/S01/S01-SUMMARY.md` — Added compressed slice summary for downstream readers.
- `.gsd/milestones/M038/slices/S01/S01-UAT.md` — Added concrete UAT script tailored to the slice contract, orchestration, and review integration behavior.
- `.gsd/PROJECT.md` — Refreshed project state to reflect M038/S01 completion and remaining M038 work.

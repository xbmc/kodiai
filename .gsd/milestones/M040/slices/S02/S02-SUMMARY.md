---
id: S02
parent: M040
milestone: M040
provides:
  - queryBlastRadiusFromSnapshot() pure function + createReviewGraphQuery() store-backed wrapper for S03 prompt integration
  - applyGraphAwareSelection() with fail-open null-graph fallback — ready for S03 to pass real query results
  - reviewGraphQuery DI seam on review handler — S03 only needs to instantiate createReviewGraphQuery(store) and pass it in
  - Four machine-verifiable proof checks in verify:m040:s02 — S03 can extend or chain against these for regression coverage
  - Structured graph-influence log fields at the large-PR triage site — ready for S03 observability
requires:
  - slice: S01
    provides: ReviewGraphStore interface, listWorkspaceGraph() snapshot API, ReviewGraphWorkspaceSnapshot type, Postgres schema, extractors, and indexer
affects:
  - S03
key_files:
  - src/review-graph/query.ts
  - src/review-graph/query.test.ts
  - src/review-graph/types.ts
  - src/review-graph/store.ts
  - src/review-graph/store.test.ts
  - src/lib/file-risk-scorer.ts
  - src/lib/file-risk-scorer.test.ts
  - src/handlers/review.ts
  - scripts/verify-m040-s02.ts
  - scripts/verify-m040-s02.test.ts
  - package.json
key_decisions:
  - Use confidence-weighted edge scoring (calls:0.92, tests:0.88, imports:0.42) with bounded heuristic fallback for incomplete cross-file edges; emit explicit confidence+reasons per ranked item
  - Optional reviewGraphQuery DI seam on review handler — fail-open, production stays on risk-only path until S03 wires the provider
  - TOP_N=1 for the MISSED-FILES proof fixture to assert rank-promotion rather than mere presence in a wider selection
  - listWorkspaceGraph() snapshot API added to ReviewGraphStore interface to support cross-file blast-radius queries through the store abstraction
patterns_established:
  - queryBlastRadiusFromSnapshot pure-function pattern: accepts a workspace snapshot and query input, returns ranked outputs with explicit confidence and reasons — testable without a DB
  - applyGraphAwareSelection additive boost pattern: score × confidence × SCALE_FACTOR boost merged onto existing risk scores; returns unchanged input when graph is null
  - Optional DI seam on review handler: reviewGraphQuery? parameter fires before large-PR triage, fail-open on errors, logs structured graph influence fields
  - TOP_N=1 rank-promotion proof: use minimum N that creates a visible gap to distinguish 'promoted above unrelated files' from 'present in a wider set'
observability_surfaces:
  - review.ts large-PR triage log: graphHitCount, graphRankedSelections, graphAwareSelectionApplied — emitted whenever large-PR triage runs, whether or not a graph query provider is wired
  - bun run verify:m040:s02 -- --json — exits 0 with machine-readable check results; run as a regression gate before S03 integration
drill_down_paths:
  - .gsd/milestones/M040/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M040/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M040/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T12:11:06.027Z
blocker_discovered: false
---

# S02: Blast-Radius Queries and Graph-Aware Review Selection

**Built the blast-radius query layer and graph-aware file reranker that turns persisted graph edges into ranked impacted files, probable dependents, and likely tests for large-PR review selection.**

## What Happened

S02 delivered the query and selection layers that convert the M040/S01 persistent graph into actionable review signals.

**T01 — Blast-radius query surface:** `src/review-graph/query.ts` implements `queryBlastRadiusFromSnapshot()`, a pure function that walks a `ReviewGraphWorkspaceSnapshot` and returns four ranked outputs: impacted files, probable dependents, likely tests, and seed symbols. The scoring model multiplies `EDGE_WEIGHT[edgeKind] × edgeConfidence × seedConfidence × (1 + KIND_BONUS[nodeKind])` so that calls-edges (0.92) and tests-edges (0.88) dominate over imports/includes (0.42) and declares (0.15). Multiple signals accumulate additively per file. When direct graph edges are sparse (current extractor fidelity on cross-file C++ resolution), the query falls back to bounded heuristics scanning import nodes, callsite nodes, and test nodes for name-based matches to changed symbols — keeping output useful without overstating certainty. All ranked items carry explicit `confidence` and `reasons` arrays so consumers can distinguish structural certainty from heuristic inference. The store was extended with a `listWorkspaceGraph()` snapshot API so the query can operate on the full workspace graph rather than a single file. The store-backed `createReviewGraphQuery()` wraps the pure function for production use.

**T02 — Graph-aware reranking in file-risk scorer and review handler:** `applyGraphAwareSelection()` in `src/lib/file-risk-scorer.ts` merges blast-radius graph signals into the existing file-risk score list. Impacted files get a `score × confidence × 35` boost; likely tests get the same scale. If no boostable paths exist, the function returns early with `usedGraph: false, graphHits: 0`, preserving the original risk order exactly. The review handler in `src/handlers/review.ts` now accepts an optional `reviewGraphQuery` DI parameter. Before large-PR triage it fires the query (fail-open on errors), then feeds the result into `applyGraphAwareSelection`. Structured log fields `graphHitCount`, `graphRankedSelections`, and `graphAwareSelectionApplied` are emitted at the triage site. Production reviews fall back to risk-only selection until the graph query provider is wired in S03.

**T03 — Machine-verifiable proof harness:** `scripts/verify-m040-s02.ts` proves four named properties using synchronous in-memory fixtures with no DB or network. GRAPH-SURFACES-MISSED-FILES: a C++ fixture where `StringUtils.h` is changed with `VideoPlayer.cpp` holding include+callsite edges — graph-aware selection ranks VideoPlayer at #1 (TOP_N=1) while risk-only puts an unrelated `OAuth2Handler.cpp` at #1. GRAPH-SURFACES-LIKELY-TESTS: a Python fixture where `test_string_utils.py` has a `tests` edge to `format_string` — graph-aware top-2 includes the test file; risk-only excludes it (test files inherit low category-risk weight). GRAPH-RERANKS-DEPENDENTS: a C++ fixture where `FileCurl::Open` calls `URIUtils::GetExtension` — blast-radius returns FileCurl as a probable dependent and graph-aware selection promotes `FileCurl.cpp` above `PVRManager.cpp` which has more lines but no graph signal. FALLBACK-PRESERVES-ORDER: passing `graph=null` returns `usedGraph=false, graphHits=0` and the exact original risk ordering. All 24 unit tests in `verify-m040-s02.test.ts` pass; the harness script exits 0 with `overallPassed: true`.

## Verification

All slice verification commands executed and passed:

1. `bun test ./src/review-graph/query.test.ts` — 2 pass, 0 fail (Python and C++ blast-radius fixtures)
2. `bun test ./src/lib/file-risk-scorer.test.ts` — 12 pass, 0 fail (graph-aware selection, fallback, triage)
3. `bun test ./scripts/verify-m040-s02.test.ts` — 24 pass, 0 fail (all four proof checks with negative injection tests)
4. `bun run verify:m040:s02 -- --json` — exits 0, `overallPassed: true`, all four checks pass with machine-readable detail strings
5. `bun run tsc --noEmit` — exits 0, zero type errors

Proof harness output:
- GRAPH-SURFACES-MISSED-FILES: `graphHits=1 graphAwareTopN=["xbmc/cores/VideoPlayer/VideoPlayer.cpp"] riskOnlyTopN=["xbmc/network/oauth/OAuth2Handler.cpp"] graphSurfacedExtra=["xbmc/cores/VideoPlayer/VideoPlayer.cpp"]`
- GRAPH-SURFACES-LIKELY-TESTS: `graphLikelyTests=["tests/utils/test_string_utils.py"] testPromoted=true graphAwareTopN=["tests/utils/test_string_utils.py","xbmc/cores/player/player.py"]`
- GRAPH-RERANKS-DEPENDENTS: `dependentCount=1 callerPromoted=true graphAwareRanking=["xbmc/filesystem/FileCurl.cpp","xbmc/pvr/PVRManager.cpp","xbmc/utils/URIUtils.cpp"]`
- FALLBACK-PRESERVES-ORDER: `usedGraph=false graphHits=0 riskOrderPreserved=true riskScoreCount=3`

## Requirements Advanced

- R037 — Blast-radius query layer and graph-aware reranker are now in place; S03 will complete the review integration and prompt binding
- R038 — Probable dependent output from queryBlastRadiusFromSnapshot provides caller/dependent evidence needed for breaking-change detection; S03 will surface this in review output

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T01: Extended the store interface with `listWorkspaceGraph()` so blast-radius queries can operate on the full workspace snapshot through the store abstraction. This was not in the task plan but was required for a real cross-file query surface. T02: Used optional `reviewGraphQuery` DI seam rather than adding a new config surface or hard-coding store access — keeps the integration local and fail-open. T03: Used TOP_N=1 for the MISSED-FILES fixture (plan did not specify a TOP_N) because TOP_N=2 left `graphSurfacedExtra` empty (the impacted file was already in the risk-only top-2 at rank 2); TOP_N=1 precisely captures the rank-promotion claim.

## Known Limitations

Production review execution remains on the fallback file-risk path until the persisted review-graph query function is passed into the review handler wiring (S03 work). Graph blast-radius ranking still uses bounded heuristics for some cross-file C++ and Python impact links because extractor-level cross-file call resolution remains intentionally shallow; confidence scores and reason strings reflect that partial certainty.

## Follow-ups

S03 must wire the graph query provider into the review handler and into the prompt packing layer. The structured log fields added in this slice (`graphHitCount`, `graphRankedSelections`, `graphAwareSelectionApplied`) are ready to surface in observability dashboards once the production wiring is active.

## Files Created/Modified

- `src/review-graph/query.ts` — New: queryBlastRadiusFromSnapshot pure function and createReviewGraphQuery store-backed wrapper
- `src/review-graph/query.test.ts` — New: Python and C++ blast-radius fixture tests
- `src/review-graph/types.ts` — Extended: ReviewGraphStore interface with listWorkspaceGraph() snapshot API; ReviewGraphWorkspaceSnapshot type
- `src/review-graph/store.ts` — Extended: listWorkspaceGraph() implemented in Postgres store and in-memory test store
- `src/review-graph/store.test.ts` — Extended: listWorkspaceGraph returns workspace snapshot test
- `src/lib/file-risk-scorer.ts` — Extended: applyGraphAwareSelection(), GraphAwareSelectionResult type, graph boost constants
- `src/lib/file-risk-scorer.test.ts` — Extended: graph-aware selection tests (fallback, promotion, out-of-scope ignore)
- `src/handlers/review.ts` — Extended: reviewGraphQuery optional DI seam, graph-aware selection call before large-PR triage, structured log fields
- `scripts/verify-m040-s02.ts` — New: four machine-verifiable proof checks for blast-radius and graph-aware selection
- `scripts/verify-m040-s02.test.ts` — New: 24-test suite for proof harness with negative injection tests
- `package.json` — Added verify:m040:s02 script

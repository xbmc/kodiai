---
verdict: pass
remediation_round: 0
---

# Milestone Validation: M038

## Success Criteria Checklist
## Success Criteria Checklist

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | M038 consumes M040 graph blast-radius and M041 canonical current-code data through explicit adapter seams, without leaking substrate internals into the review handler. | ✅ PASS | S01 delivered `src/structural-impact/adapters.ts` with `GraphAdapter` and `CorpusAdapter` local seams that mirror only M038-needed fields. `review.ts` calls `fetchReviewStructuralImpact()` — never the substrate directly. 18 adapter tests pass, 9 review-integration tests pass. |
| 2 | A large C++ or Python review shows a bounded Structural Impact section in Review Details and uses structural evidence to strengthen breaking-change output. | ✅ PASS | S02 delivered `src/lib/structural-impact-formatter.ts` and wired it into `review-utils.ts` and `review-prompt.ts`. `bun run verify:m038:s02 -- --json` exits 0, `overallPassed:true`. Both C++ (`M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT`) and Python (`M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE`) checks pass. `promptStructuralImpactHeadingCount:1`, `reviewDetailsStructuralImpactHeadingCount:1` for both scenarios. |
| 3 | Repeated reviews reuse cached structural-impact results (no redundant substrate calls within TTL). | ✅ PASS | S03 delivered `src/structural-impact/cache.ts` with 256-entry LRU/10-min TTL, handler-level injection. Verifier check `M038-S03-CACHE-REUSE` passes: `firstCacheMiss=true; firstAdapterCalls=2; secondCacheHit=true; noNewAdapterCalls=true`. |
| 4 | Substrate failures degrade cleanly — timeouts produce `unavailable` status, no invented evidence, and review completion is not blocked. | ✅ PASS | `M038-S03-TIMEOUT-FAIL-OPEN`: `status=unavailable; degs=2; elapsedMs=41; completedBeforeAdapters=true; noInventedEvidence=true; fallbackUsed=true`. `M038-S03-SUBSTRATE-FAILURE-TRUTHFUL`: `noCallers=true; noEvidence=true; graphStatsNull=true; truthfulnessSignals=[graph-unavailable,corpus-unavailable,no-structural-evidence]`. |
| 5 | Asymmetric (partial) failure shows only available evidence; degradation is per-source not global. | ✅ PASS | `M038-S03-PARTIAL-DEGRADATION-TRUTHFUL`: case1[graphOk+corpusFail] and case2[graphFail+corpusOk] both pass with `hasRenderableEvidence=true` from the live source only. |
| 6 | Breaking-change output is structurally grounded when evidence is present and fails open truthfully when it is absent. | ✅ PASS | S02 prompt tests verify `breaking-change instructions use structural evidence when callers or impacted files are present`, `fall back when structural impact is absent`, and `call out partial structural evidence truthfully`. S03 verifier confirms fallbackUsed=true with no invented claims on all failure paths. |
| 7 | Repository TypeScript compiles clean throughout. | ✅ PASS | `bun run tsc --noEmit` exits 0 (clean, no output) confirmed at each slice closure and again during validation. |
| 8 | All 61 structural-impact unit tests pass. | ✅ PASS | `bun test ./src/structural-impact/` → 61 pass, 0 fail, 190 expect() calls. |

## Slice Delivery Audit
## Slice Delivery Audit

| Slice | Claimed Output | Delivered? | Evidence |
|-------|---------------|------------|----------|
| S01 — Graph/Corpus Consumer Adapters and Orchestration | Bounded `StructuralImpactPayload` contract; `GraphAdapter`/`CorpusAdapter` seams; concurrent fail-open orchestration with timeout/degradation/cache; review handler wired through `fetchReviewStructuralImpact()`. | ✅ Full | `src/structural-impact/types.ts`, `adapters.ts`, `orchestrator.ts`, `review-integration.ts` all delivered. Tests: 18+25+9=52 pass. `review.ts` confirmed using seam. Three-state status contract (ok/partial/unavailable) in place. 12-signal onSignal observability implemented. |
| S02 — Structural Impact Rendering and Review Flow Integration | Bounded Structural Impact section in Review Details and review prompt; truthful confidence wording; hard caps + truncation metadata; deterministic C++/Python verifier (`verify:m038:s02`). | ✅ Full | `structural-impact-formatter.ts` renders callers, impacted files, tests, unchanged-code evidence with caps. `review-utils.ts` and `review-prompt.ts` threaded. `verify:m038:s02 --json` passes both check IDs. Fixture drift (autoBand field + stream stub return type) discovered and fixed during slice closure — repo left clean. |
| S03 — Timeout, Cache Reuse, and Fail-Open Verification | Dedicated cache module; degradation normalizer; four-check verifier (`verify:m038:s03`) covering cache reuse, timeout fail-open, substrate-failure truthfulness, and partial-degradation truthfulness. | ✅ Full | `cache.ts` (4 tests), `degradation.ts` (4 tests), `verify-m038-s03.ts` (11 verifier tests). `verify:m038:s03 --json` → `overallPassed:true`, all 4 checks pass. `tsc --noEmit` clean. 61/61 structural-impact tests pass. |

## Cross-Slice Integration
## Cross-Slice Integration Audit

| Boundary | Produces (claimed) | Consumes (claimed) | Alignment |
|----------|-------------------|--------------------|-----------|
| S01 → S02 | Bounded `StructuralImpactPayload`; `fetchReviewStructuralImpact()` seam; degradation records; three-state status; review-integration hooks | S02 formatter and prompt code consume `StructuralImpactPayload` without direct substrate coupling | ✅ Aligned — S02 summary explicitly lists S01's `fetchReviewStructuralImpact()` and bounded payload as its required upstream. S02's `formatReviewDetailsSummary()` and `buildReviewPrompt()` accept the bounded payload shape defined in S01's `types.ts`. No substrate types appear in S02 rendering code. |
| S01/S02 → S03 | `fetchStructuralImpact()` orchestrator with `StructuralImpactCache` injection point; `GraphAdapter`/`CorpusAdapter` seams; `StructuralImpactPayload`/`StructuralImpactDegradation` types; review handler wiring; formatter; Review Details and prompt rendering surfaces | S03 cache module, degradation normalizer, and verifier all consume S01/S02 contracts without re-defining them | ✅ Aligned — S03 explicitly lists both S01 and S02 in its `requires` block. `cache.ts` uses `buildStructuralImpactCacheKey()` from S01. `degradation.ts` consumes `StructuralImpactPayload` from S01 types. S03 verifier exercises the same rendering pipeline S02 defined. |
| M040 → S01 | `ReviewGraphBlastRadiusResult`/`queryBlastRadius` output consumed through `GraphAdapter` seam | S01 mirrors only needed fields in local consumer type | ✅ Aligned — S01 decision log confirms "Define graph/corpus adapter contracts locally in src/structural-impact instead of importing substrate result types directly". `probableDependents` → `probableCallers` rename is documented as an intentional bounded translation, not a contract break. |
| M041 → S01 | `searchCanonicalCode()` with canonical ref and commit provenance consumed through `CorpusAdapter` seam | S01 consumes only needed fields via local mirror type | ✅ Aligned — S01 summary confirms `CorpusAdapter` seam normalizes M041 output into `canonicalEvidence` without importing M041-native types into the review path. |

No boundary mismatches found. All cross-slice contracts were established in S01 and consumed cleanly by S02 and S03 without re-coupling to substrate-native types.

## Requirement Coverage
## Requirement Coverage

| Req | Status | Addressed By | Proof |
|-----|--------|-------------|-------|
| R037 — Surface structurally-grounded impact context (graph blast-radius + canonical unchanged-code) in reviews | **validated** | S01 (adapter/orchestration), S02 (rendering) | `bun run verify:m038:s02 --json` passes `M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT` and `M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE`. Review Details includes changed symbols, probable callers, impacted files, likely tests, and canonical unchanged-code evidence. Requirements table shows status=validated. |
| R038 — Breaking-change detection grounded with caller/dependent evidence; fail open when substrate unavailable | **validated** | S02 (prompt grounding), S03 (fail-open proof) | `bun run verify:m038:s03 --json` exits 0 with all four checks passing. `summarizeStructuralImpactDegradation()` is the single source of truth for availability/truthfulness classification, preventing overstatement. S02 prompt tests cover evidence-present/partial/fallback-used cases. Requirements table shows status=validated. |

Both active requirements for M038 are validated with machine-readable proof. No active requirements are unaddressed or unmapped. The REQUIREMENTS.md coverage summary confirms 0 unmapped active requirements.

## Verification Class Compliance
## Verification Class Compliance

### Contract ✅ PASS
**Planned:** Unit and fixture verification must prove M038 consumes substrate APIs, bounds its structural-impact payload, and never blocks review completion when graph or corpus data is unavailable.

**Evidence:** S01 delivered 52 unit tests (18 adapter, 25 orchestrator, 9 review-integration) proving the bounded payload contract, fail-open behavior, three-state status, and zero substrate imports in consumer code. S02 delivered 8 formatter tests and S03 delivered 4 cache + 4 degradation tests. All 61 structural-impact tests pass. `tsc --noEmit` exits 0. The review handler is never blocked: unavailable/partial payloads are always returned, never thrown.

### Integration ✅ PASS
**Planned:** Integration proof must show graph blast radius plus canonical unchanged-code evidence flowing into Review Details and breaking-change output for C++ or Python review fixtures.

**Evidence:** `bun run verify:m038:s02 --json` exits 0 with `overallPassed:true`. Both C++ and Python scenarios confirm: `promptIncludesStructuralSection:true`, `reviewDetailsIncludesStructuralSection:true`, `reviewDetailsIncludesCaller:true`, `reviewDetailsIncludesEvidencePath:true`, `promptUsesStructuralBreakingChangeWording:true`, `renderedCounts:true`. The verifier exercises the real prompt and Review Details seams, not reimplemented logic.

### Operational ✅ PASS
**Planned:** Operational verification must demonstrate timeout behavior, cache reuse for repeated commit pairs, explicit degradation signals, and fail-open review completion.

**Evidence:** `bun run verify:m038:s03 --json` exits 0 with all four checks passing:
- **Cache reuse:** `M038-S03-CACHE-REUSE` — `secondCacheHit=true; noNewAdapterCalls=true` (256-entry LRU, 10-min TTL, handler-level injection).
- **Timeout fail-open:** `M038-S03-TIMEOUT-FAIL-OPEN` — `elapsedMs=41` against 500ms adapters; `completedBeforeAdapters=true; noInventedEvidence=true; fallbackUsed=true`.
- **Explicit degradation signals:** `summarizeStructuralImpactDegradation()` emits machine-readable `truthfulnessSignals` array (graph-unavailable, corpus-unavailable, no-structural-evidence) on every degraded path; 12-signal onSignal observability in orchestrator.
- **Fail-open completion:** Review never throws on substrate failure; `status=unavailable` + empty evidence fields guaranteed.

**Known gap (minor, non-blocking):** The structural-impact cache is process-local and in-memory only. Cross-process or persistent cache reuse is not implemented — each handler restart starts with an empty cache. This is documented as a known limitation in the S03 summary and is acceptable for the current deployment model.

### UAT ✅ PASS
**Planned:** A user can review a large C++ or Python PR and see a bounded Structural Impact section with caller/dependent evidence; rerun and observe cached reuse; if substrate data is unavailable, review completes without invented structural claims.

**Evidence:** 
- C++/Python Review Details rendering: verified by `verify:m038:s02` with explicit section heading counts and field presence checks.
- Cache reuse on rerun: verified by `M038-S03-CACHE-REUSE` with call-counting adapters.
- No invented claims on substrate failure: verified by `M038-S03-SUBSTRATE-FAILURE-TRUTHFUL` (`noCallers=true; noEvidence=true; graphStatsNull=true`) and `M038-S03-TIMEOUT-FAIL-OPEN` (`noInventedEvidence=true`).
- Partial evidence (one substrate live, one down): verified by `M038-S03-PARTIAL-DEGRADATION-TRUTHFUL` for both asymmetric orientations.
All UAT test cases in S01/S02/S03 UAT documents have green verification evidence.


## Verdict Rationale
All three slices delivered their full claimed outputs, both target requirements (R037, R038) transitioned to validated status with machine-readable proof, all four verification classes have concrete evidence, both deterministic verifiers exit 0 with overallPassed:true, all 61 structural-impact tests pass, and tsc --noEmit is clean. The only gap (process-local in-memory cache with no cross-process reuse) is a documented known limitation in the S03 summary — it is within scope and does not compromise the milestone's correctness or completeness goals.

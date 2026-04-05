---
id: M038
title: "AST Call-Graph Impact Analysis"
status: complete
completed_at: 2026-04-05T21:17:50.723Z
key_decisions:
  - Define graph/corpus adapter contracts locally in src/structural-impact/ (not importing substrate result types directly), keeping M040/M041 substrate changes bounded to one wiring seam per adapter.
  - Use a three-state structural-impact status contract (ok/partial/unavailable) so downstream formatters and prompt code can distinguish complete, degraded, and absent evidence without branching on raw degradation arrays.
  - Cache partial as well as full structural-impact results to avoid repeatedly hammering slow or failing substrates — partial payloads are a truthful snapshot of what was available at cache time; TTL is the release valve.
  - Render Structural Impact in Review Details with hard per-list caps and explicit shown/total/truncated metadata rather than relying on an opaque character budget alone.
  - Use stronger graph evidence wording only for full-confidence graph edges; label all lower-confidence graph results as 'probable' — confidence wording is a contract, not a style choice.
  - Thread the bounded structural-impact payload separately from raw graph blast-radius data so prompt/review rendering can evolve without coupling to substrate-native types.
  - Strengthen breaking-change instructions only when truthful structural evidence is present; otherwise emit explicit fallback-used or partial-evidence guidance instead of overstating certainty.
  - Extract structural-impact cache into a dedicated cache.ts module with a factory and inject at handler level (never constructed inside the orchestrator) so each handler owns its cache lifecycle and tests can inject isolated instances.
  - Centralize structural-impact truthfulness and fallback classification in degradation.ts (summarizeStructuralImpactDegradation) as the single rendering gate rather than duplicating partial/unavailable logic across formatter and handler.
  - Each verifier check is independently exported so tests can assert pass/fail per check without running the full harness.
key_files:
  - src/structural-impact/types.ts
  - src/structural-impact/adapters.ts
  - src/structural-impact/adapters.test.ts
  - src/structural-impact/orchestrator.ts
  - src/structural-impact/orchestrator.test.ts
  - src/structural-impact/review-integration.ts
  - src/structural-impact/review-integration.test.ts
  - src/structural-impact/cache.ts
  - src/structural-impact/cache.test.ts
  - src/structural-impact/degradation.ts
  - src/structural-impact/degradation.test.ts
  - src/lib/structural-impact-formatter.ts
  - src/lib/structural-impact-formatter.test.ts
  - src/lib/review-utils.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - src/handlers/review.ts
  - scripts/verify-m038-s02.ts
  - scripts/verify-m038-s02.test.ts
  - scripts/verify-m038-s03.ts
  - scripts/verify-m038-s03.test.ts
  - package.json
lessons_learned:
  - Full-repo typecheck at slice closure (not just unit tests) catches fixture drift that individual task-level checks miss — the S02 slice closer caught two real TypeScript issues (missing autoBand field, wrong stream stub return type) that would have silently broken the verifier in CI.
  - Consumer-adapter seam pattern works well for milestone isolation: mirror only the fields you need, translate naming at the boundary (probableDependents → probableCallers), and keep the consumer entirely ignorant of substrate-native types. The result is that M040/M041 type changes cannot reach review rendering without touching one file.
  - Injecting the cache at handler level rather than inside the orchestrator is worth the extra wiring cost — it enables per-handler lifecycle ownership, isolated test injection, and clean TTL semantics without making the orchestrator aware of caching policy.
  - A dedicated degradation normalizer (summarizeStructuralImpactDegradation) pays for itself immediately: without it, the formatter and review handler each had to re-derive graph/corpus availability from raw degradation arrays, creating subtle inconsistencies in edge cases like graph-available-but-empty.
  - Asymmetric partial-degradation coverage (both graph-ok+corpus-fail and graph-fail+corpus-ok in one verifier check) is necessary — the two paths exercise different code branches and one orientation can pass while the other fails silently.
  - Deterministic fixture-based verifiers that exercise real formatter and prompt seams (not reimplemented logic) give more useful signal than unit tests alone: they prove the shipped user-visible contract, not just internal correctness.
  - Confidence wording should be a first-class contract decision, not a style choice. Establishing 'full-confidence graph edge' vs 'probable graph evidence' as a two-level contract in S02 prevented later rendering code from accidentally overstating certainty on lower-confidence graph paths.
---

# M038: AST Call-Graph Impact Analysis

**M038 wired M040 graph blast-radius and M041 canonical current-code substrates into the Kodiai review pipeline through explicit adapter seams, delivering bounded Structural Impact rendering in Review Details and review prompts, structurally grounded breaking-change guidance, per-request cache reuse, and a fully machine-verified fail-open degradation path for all substrate failure modes.**

## What Happened

M038 built the consumer-facing structural-impact layer that sits between Kodiai's two substrate milestones (M040 graph, M041 canonical corpus) and the review output contract.

S01 established the foundational plumbing: bounded StructuralImpactPayload, local GraphAdapter and CorpusAdapter seams that mirror only the M038-needed fields from substrate types, and a concurrent orchestrator (fetchStructuralImpact) with per-adapter timeout racing, fail-open degradation records, and a 12-signal onSignal observability surface. The review handler was rewired through a single fetchReviewStructuralImpact() seam so review.ts no longer reaches into the graph substrate directly, and the cache key (repo + baseSha + headSha) was stabilized for downstream reuse.

S02 turned the bounded payload into review-visible output. A dedicated formatter (structural-impact-formatter.ts) renders changed symbols, graph coverage, probable callers/dependents, impacted files, likely tests, and canonical unchanged-code evidence with explicit hard caps, truncation metadata, and truthful confidence wording (full-confidence vs probable). review-utils.ts appends a Structural Impact subsection to Review Details; review-prompt.ts injects a Structural Impact Evidence section and breaking-change instructions that distinguish evidence-present, partial-evidence, and fallback-used cases. The deterministic verify:m038:s02 harness proved both C++ and Python rendering paths via real formatter and prompt seams, not reimplemented logic. During slice closure, full-repo typecheck surfaced two fixture drifts (missing autoBand field on ResolvedReviewProfile fixtures, void vs boolean stream stub returns) that were fixed before the slice was marked done.

S03 hardened the operational path. A dedicated cache module (cache.ts) with a 256-entry LRU / 10-min TTL was extracted from the orchestrator and injected at handler level so each handler owns its cache lifecycle. A degradation normalizer (degradation.ts) centralized all availability/truthfulness classification so formatter and handler code uses summarizeStructuralImpactDegradation() as the single gate rather than re-deriving partial/unavailable logic from raw fields. The four-check verify:m038:s03 harness proved: cache reuse (second same-SHA pair call hits cache, zero adapter invocations); timeout fail-open (40ms cutoff against 500ms adapters, review completes in 41ms with no invented evidence); substrate-failure truthfulness (both substrates throw → unavailable + empty callers/evidence + truthfulnessSignals); and partial-degradation coverage for both asymmetric orientations (graph-ok+corpus-fail and graph-fail+corpus-ok).

Final state: 22 new source files, 4,770 lines added, all 61 structural-impact unit tests passing, both verifier harnesses exiting with overallPassed:true, and bun run tsc --noEmit clean throughout.

## Success Criteria Results

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | M038 consumes M040 graph blast-radius and M041 canonical current-code data through explicit adapter seams, without leaking substrate internals into the review handler. | ✅ MET | `src/structural-impact/adapters.ts` defines local `GraphAdapter` and `CorpusAdapter` seams that mirror only M038-needed fields. `review.ts` calls `fetchReviewStructuralImpact()` exclusively — no direct substrate calls. 18 adapter tests + 9 review-integration tests all pass. |
| 2 | A large C++ or Python review shows a bounded Structural Impact section in Review Details and uses structural evidence to strengthen breaking-change output. | ✅ MET | `verify:m038:s02 --json` exits 0, `overallPassed:true`. Both `M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT` and `M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE` pass. `promptStructuralImpactHeadingCount:1`, `reviewDetailsStructuralImpactHeadingCount:1`, `reviewDetailsIncludesCaller:true`, `reviewDetailsIncludesEvidencePath:true` confirmed for both scenarios. |
| 3 | Repeated reviews reuse cached structural-impact results (no redundant substrate calls within TTL). | ✅ MET | `M038-S03-CACHE-REUSE`: `firstCacheMiss=true; firstCacheWrite=true; firstAdapterCalls=2; secondCacheHit=true; noNewAdapterCalls=true; secondStatusMatches=true`. 256-entry LRU, 10-min TTL, handler-level injection. |
| 4 | Substrate failures degrade cleanly — timeouts produce unavailable status, no invented evidence, and review completion is not blocked. | ✅ MET | `M038-S03-TIMEOUT-FAIL-OPEN`: `status=unavailable; elapsedMs=41; completedBeforeAdapters=true; noInventedEvidence=true; fallbackUsed=true`. `M038-S03-SUBSTRATE-FAILURE-TRUTHFUL`: `noCallers=true; noEvidence=true; graphStatsNull=true; truthfulnessSignals=[graph-unavailable,corpus-unavailable,no-structural-evidence]`. |
| 5 | Asymmetric (partial) failure shows only available evidence; degradation is per-source not global. | ✅ MET | `M038-S03-PARTIAL-DEGRADATION-TRUTHFUL`: case1[graphOk+corpusFail] and case2[graphFail+corpusOk] both report `hasRenderableEvidence=true` from the live source only. |
| 6 | Breaking-change output is structurally grounded when evidence is present and fails open truthfully when absent. | ✅ MET | S02 prompt tests verify evidence-present, partial, and fallback-used paths distinctly. S03 verifier confirms `fallbackUsed=true` and `noInventedEvidence=true` on all degraded paths. |
| 7 | Repository TypeScript compiles clean throughout. | ✅ MET | `bun run tsc --noEmit` exits 0 (no output) at each slice closure and at milestone validation. |
| 8 | All 61 structural-impact unit tests pass. | ✅ MET | `bun test ./src/structural-impact/` → 61 pass, 0 fail, 190 expect() calls. |

## Definition of Done Results

- **All slices ✅:** S01, S02, S03 are all marked `[x]` in the roadmap and their summaries exist at `.gsd/milestones/M038/slices/S0{1,2,3}/S0{1,2,3}-SUMMARY.md`.
- **Code changes exist:** `git diff ff1ff975e2..HEAD -- ':!.gsd/'` shows 22 files changed, 4,770 insertions, 13 deletions. Full new module under `src/structural-impact/`, new scripts, and targeted changes to `src/lib/`, `src/execution/`, `src/handlers/review.ts`, and `package.json`.
- **Unit tests pass:** 61/61 structural-impact tests pass (adapters 18, orchestrator 25, review-integration 9, cache 4, degradation 4, plus formatter and review-prompt tests).
- **Verifiers pass:** `bun run verify:m038:s02 -- --json` exits 0 with `overallPassed:true`; `bun run verify:m038:s03 -- --json` exits 0 with `overallPassed:true`.
- **TypeScript clean:** `bun run tsc --noEmit` exits 0 throughout.
- **Requirements R037 and R038 transitioned to validated** with machine-readable proof from both verifier harnesses.
- **Cross-slice integration verified:** S01→S02 boundary (bounded payload consumed without substrate coupling), S02→S03 boundary (formatter and rendering seams reused by S03 verifier), M040→S01 and M041→S01 (adapter mirrors confirmed in S01 decisions).
- **VALIDATION.md written:** verdict=pass, all four verification classes have concrete evidence.
- **KNOWLEDGE.md updated:** Four new entries covering cache injection pattern, degradation normalizer pattern, asymmetric partial-degradation verifier pattern, and the structural-impact cache keying details.

## Requirement Outcomes

### R037 — Surface structurally-grounded impact context in reviews
- **Previous status:** active
- **New status:** validated
- **Evidence:** `bun run verify:m038:s02 -- --json` passes `M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT` and `M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE`. Review Details includes changed symbols, probable callers, impacted files, likely tests, and canonical unchanged-code evidence with explicit rendered/truncated counts. Prompt contains a `## Structural Impact Evidence` section referencing graph coverage stats.

### R038 — Breaking-change detection structurally grounded with caller/dependent evidence; fail open when substrate unavailable
- **Previous status:** active
- **New status:** validated
- **Evidence:** `bun run verify:m038:s03 -- --json` exits 0 with all four checks passing. `summarizeStructuralImpactDegradation()` is the single-source-of-truth for availability/truthfulness classification. S02 prompt tests verify evidence-present, partial-evidence, and fallback-used breaking-change instruction variants. S03 verifier confirms `fallbackUsed=true` and `noInventedEvidence=true` on timeout and full-substrate-failure paths; `hasRenderableEvidence=true` from the live source on asymmetric partial-failure paths.

## Deviations

M040's probableDependents field is renamed to probableCallers in the bounded consumer payload (adapters.ts) for clearer downstream review semantics, while the adapter mirror type preserves the raw substrate field name. This translation is documented in the S01 decisions and KNOWLEDGE.md.\n\nS01 temporarily returned both the bounded payload and captured raw graphBlastRadius from the review integration seam so review.ts could migrate incrementally without changing the existing prompt contract in that slice. S02 completed the migration by fully threading the bounded payload through rendering.\n\nS02 slice closure required two fixture repairs (ResolvedReviewProfile missing autoBand field; writable stream stubs returning void instead of boolean) that were discovered during full-repo typecheck but not during task-level unit tests. Both were fixed before the slice was marked done — no functional scope was descoped.

## Follow-ups

Cache is process-local and in-memory only — each handler restart starts with an empty structural-impact cache. Cross-process or persistent cache reuse is not implemented. This is acceptable for the current deployment model but should be revisited if multiple concurrent review handler instances need to share blast-radius results for the same commit pair.\n\nThe verify:m038:s02 and verify:m038:s03 harnesses are fixture-based and hermetic — they prove the rendering and fail-open contracts but do not exercise live graph or canonical-corpus adapters. End-to-end integration tests against a real graph substrate and real corpus remain a future gap.\n\nThe structural-impact-formatter.ts hard caps (callers, impacted files, likely tests, canonical evidence) were set conservatively. If production reviews regularly hit truncation on large monorepos, the caps may need tuning with real usage data.\n\nNext unblocked work: M039 (Review Output Hardening) and M035/S02 (Reranker Pipeline Wiring).

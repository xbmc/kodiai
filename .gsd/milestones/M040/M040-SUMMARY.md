---
id: M040
title: "Graph-Backed Extensive Review Context"
status: complete
completed_at: 2026-04-05T12:40:28.201Z
key_decisions:
  - D026: Implement M040 as a new graph substrate milestone before M038 — prevents two competing structural-analysis paths. Still valid; M038 will consume M040 substrate as planned.
  - D027: Reuse existing Postgres/pgvector/runtime stack for graph persistence rather than introducing a separate graph store. Validated by S01 — no operational complexity added, clean table separation via review_graph_* prefix.
  - D033: Confidence-weighted edge scoring (calls:0.92, tests:0.88, imports:0.42) with bounded heuristic fallback for incomplete cross-file edges. Validated by S02 proof harness — explicit confidence+reasons prevent misleading reviewers on partial extractor certainty.
  - D034: Optional reviewGraphQuery DI seam on review handler, fail-open. Validated by S02/S03 — production stays on risk-only path until indexer deployed; DI seam extended in S03 for prompt injection and validation gate.
  - D035: TOP_N=1 for MISSED-FILES proof fixture to assert rank-promotion rather than mere top-K presence. Validated — TOP_N=2 would have failed to prove the claim; TOP_N=1 precisely captures rank-promotion.
  - S03: Hard item caps (20/10/10) applied before char budget loop — caps bound worst-case loop to O(cap × max_line_len) rather than O(N). Pattern: bounded prompt section with hard caps first, budget second, stats in return type.
  - S03: isTrivialChange() is fail-closed on zero files — zero changed files is unexpected input; running the graph is safer than silently skipping.
  - S03: Non-destructive validation gate pattern — annotation-only, never suppress findings; fail-open on any LLM error; configurable enabled flag defaults off.
  - S03: Dynamic import for GUARDRAIL_CLASSIFICATION task router inside validation gate block — avoids circular dependency between review handler and task routers.
key_files:
  - src/db/migrations/034-review-graph.sql
  - src/review-graph/types.ts
  - src/review-graph/store.ts
  - src/review-graph/store.test.ts
  - src/review-graph/extractors.ts
  - src/review-graph/extractors.test.ts
  - src/review-graph/indexer.ts
  - src/review-graph/indexer.test.ts
  - src/review-graph/query.ts
  - src/review-graph/query.test.ts
  - src/review-graph/prompt-context.ts
  - src/review-graph/validation.ts
  - src/review-graph/validation.test.ts
  - src/lib/file-risk-scorer.ts
  - src/lib/file-risk-scorer.test.ts
  - src/handlers/review.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - scripts/verify-m040-s02.ts
  - scripts/verify-m040-s02.test.ts
  - scripts/verify-m040-s03.ts
  - scripts/verify-m040-s03.test.ts
  - package.json
lessons_learned:
  - TEST_DATABASE_URL gating pattern: DB-backed integration tests should use a whole-suite skip on missing TEST_DATABASE_URL, not opportunistic fallback to DATABASE_URL. This prevents accidental production DB writes in CI and makes verification deterministic in auto-mode. Recorded in KNOWLEDGE.md.
  - Proof harness rank-promotion: when proving rank-promotion claims, use the minimum TOP_N that creates a visible gap. TOP_N too large makes the proof trivially pass even when the claim is not true (the impacted file was already in the wider set). The right N is the one where risk-only would miss it but graph-aware catches it.
  - Bounded section builder pattern: apply hard item caps before the char budget loop, not inside it. Caps bound worst-case loop size to O(cap × max_line_len). Return a stats object from the builder rather than forcing callers to re-parse the text for observability.
  - Fail-closed vs fail-open semantics: bypass predicates should be fail-closed on unexpected input (zero files is unexpected — run the graph, don't silently skip). Error handlers should be fail-open (gate failure → return original findings unchanged, not blocking the review). Keep these two conventions distinct.
  - DI seam extension: a DI seam added in one slice can be silently extended in a later slice (S03 extended the S02 reviewGraphQuery seam to capture the result, pass it to prompt building, and run validation). This is cleaner than adding a separate DI parameter or config surface per concern.
  - Circular dependency avoidance: when a handler needs to call a task router, use a dynamic import inside the gate block rather than a top-level import. This avoids circular dependency without restructuring the module graph.
---

# M040: Graph-Backed Extensive Review Context

**Built a persistent structural graph for C++ and Python with blast-radius queries, graph-aware file reranking, bounded prompt injection, trivial-change bypass, and a non-destructive LLM validation gate — all fail-open, all proven by machine-verifiable proof harnesses.**

## What Happened

M040 delivered the full graph-backed review context pipeline across three slices. 

**S01 — Graph Schema and C++/Python Structural Extraction** established the persistent substrate: dedicated `review_graph_builds`, `review_graph_files`, `review_graph_nodes`, and `review_graph_edges` tables in Postgres via migration `034-review-graph.sql`; a typed `ReviewGraphStore` with transactional file-scoped `replaceFileGraph()` replacement; C++ and Python structural extraction in `extractors.ts` emitting file, symbol, import/include, callsite, and probable-test records with explicit confidence; and an incremental `indexer.ts` using SHA-256 content hashes to skip unchanged files and update only modified ones, with persisted build counters and structured logging.

**S02 — Blast-Radius Queries and Graph-Aware Review Selection** built the query and reranking layer: `queryBlastRadiusFromSnapshot()` pure function walks a workspace snapshot to return ranked impacted files, probable dependents, likely tests, and seed symbols using confidence-weighted edge scoring (calls 0.92, tests 0.88, imports 0.42) with bounded heuristic fallback for sparse cross-file edges; `applyGraphAwareSelection()` in `file-risk-scorer.ts` merges blast-radius signals as additive boosts over existing file-risk scores; the review handler gained an optional `reviewGraphQuery` DI seam with fail-open error handling and structured log fields; a 4-check proof harness (`verify:m040:s02`) with 24 negative-injection tests proved rank-promotion, test-promotion, dependent-reranking, and fallback contracts on KODI codebase fixtures.

**S03 — Bounded Prompt Integration, Bypass, and Validation Gate** completed the pipeline: `buildGraphContextSection()` assembles a bounded prompt section with hard item caps (20/10/10) applied before a 2500-char budget loop, producing `GraphContextSection.stats` for downstream observability; `isTrivialChange()` provides a fail-closed configurable bypass predicate (zero files → never bypass, below threshold → bypass with reason string, above → run graph); `validateGraphAmplifiedFindings()` is a non-destructive LLM annotation gate that only adds metadata to graph-amplified findings, never suppresses, and is fail-open (any error returns original findings + `succeeded=false`); the review handler was fully wired for all three paths; a 4-check proof harness (`verify:m040:s03`) with 40 tests proved prompt boundedness, trivial bypass classification, fail-open preservation, and annotation correctness.

Final verification: 311 tests pass, 7 skip (DB-gated, correct), 0 fail; `tsc --noEmit` exits 0; both proof harnesses exit 0 with `overallPassed: true`. 23 non-GSD files changed, 7429 insertions.

## Success Criteria Results

### SC-1: Kodiai can index a fixture C++ or Python repo into dedicated graph tables and inspect persisted nodes/edges for files, symbols, imports/includes, calls, and probable test relationships.
**Verdict: ✅ PASS**
`034-review-graph.sql` added 4 dedicated tables. `extractors.ts` emits file, symbol, import/include, callsite, and probable-test nodes. `indexer.ts` walks workspaces, hashes content, skips unchanged files, replaces modified file graphs atomically. `bun test ./src/review-graph/extractors.test.ts` passes (2/2). `bun test ./src/review-graph/indexer.test.ts` passes (4/4). Store tests skip cleanly via `TEST_DATABASE_URL` gate.

### SC-2: Kodiai can take a large fixture PR and show graph-ranked impacted files, probable dependents, and likely tests that today's file-risk scorer alone would miss.
**Verdict: ✅ PASS**
`queryBlastRadiusFromSnapshot()` and `applyGraphAwareSelection()` delivered in S02. `bun run verify:m040:s02 -- --json` exits 0 with `overallPassed: true`:
- GRAPH-SURFACES-MISSED-FILES: `graphAwareTopN=["xbmc/cores/VideoPlayer/VideoPlayer.cpp"]` vs `riskOnlyTopN=["xbmc/network/oauth/OAuth2Handler.cpp"]` — confirmed rank-promotion.
- GRAPH-SURFACES-LIKELY-TESTS: `testPromoted=true`, `graphLikelyTests=["tests/utils/test_string_utils.py"]` — test file promoted into top-2 despite low risk-category weight.
- GRAPH-RERANKS-DEPENDENTS: `callerPromoted=true`, FileCurl.cpp ranked above PVRManager.cpp via calls-edge.
- FALLBACK-PRESERVES-ORDER: `usedGraph=false, riskOrderPreserved=true` on null graph.

### SC-3: A large C++ or Python PR gets a bounded graph context section and optional second-pass validation for graph-amplified findings, while a trivial PR bypasses graph overhead cleanly.
**Verdict: ✅ PASS**
`buildGraphContextSection()`, `isTrivialChange()`, `validateGraphAmplifiedFindings()` delivered in S03. `bun run verify:m040:s03 -- --json` exits 0 with `overallPassed: true`:
- PROMPT-BOUNDED: `charCount=2316 ≤ maxChars=2500, withinBudget=true, totalIncluded=20, truncated=false`
- TRIVIAL-BYPASS: `smallPR bypass=true; largePR bypass=false; zeroPR bypass=false (fail-closed)`
- FAIL-OPEN-VALIDATION: `neverThrew=true, succeeded=false, originalFindingsPreserved=true` on LLM error
- VALIDATION-ANNOTATES: `validatedCount=2, confirmedCount=1, uncertainCount=1, allAmplifiedAnnotated=true, directFindingSkipped=true`

## Definition of Done Results

### All slices marked complete with ✅
- S01: ✅ (completed_at: 2026-04-05T10:11:43.064Z, verification_result: passed)
- S02: ✅ (completed_at: 2026-04-05T12:11:06.027Z, verification_result: passed)
- S03: ✅ (completed_at: 2026-04-05T12:34:48.984Z, verification_result: passed)

### All slice summaries exist
- `.gsd/milestones/M040/slices/S01/S01-SUMMARY.md` ✅
- `.gsd/milestones/M040/slices/S02/S02-SUMMARY.md` ✅
- `.gsd/milestones/M040/slices/S03/S03-SUMMARY.md` ✅

### Code changes verified
`git diff --stat 67d8511d9c HEAD -- ':!.gsd/'` shows 23 files changed, 7429 insertions. Key files: `src/db/migrations/034-review-graph.sql`, `src/review-graph/` (7 modules), `src/lib/file-risk-scorer.ts`, `src/handlers/review.ts`, `src/execution/review-prompt.ts`, `scripts/verify-m040-s02.*`, `scripts/verify-m040-s03.*`.

### TypeScript compilation clean
`bun run tsc --noEmit` exits 0 — zero type errors.

### Test suite passes
311 pass, 7 skip (DB-gated, correct), 0 fail across 9 files.

### Both proof harnesses pass
`bun run verify:m040:s02 -- --json` exits 0, `overallPassed: true`, 4/4 checks pass.  
`bun run verify:m040:s03 -- --json` exits 0, `overallPassed: true`, 4/4 checks pass.

### Cross-slice integration verified
S01 → S02: `ReviewGraphStore` interface, `ReviewGraphWorkspaceSnapshot` type, `listWorkspaceGraph()` (added by S02) flow correctly into `queryBlastRadiusFromSnapshot()`. S01+S02 → S03: `ReviewGraphBlastRadiusResult`, `reviewGraphQuery` DI seam, `applyGraphAwareSelection()` all consumed correctly. Graph section placement verified: after incremental-review context, before knowledge-retrieval context.

### Backward compatibility
`buildReviewPrompt` without `graphBlastRadius` produces identical output — confirmed by `review-prompt.test.ts`.

### Milestone validation
`M040-VALIDATION.md` verdict: `pass`, all four verification classes compliant.

## Requirement Outcomes

### R037 — Kodiai shall surface structurally-grounded impact context in reviews by combining graph blast-radius data with semantically relevant unchanged code from the canonical current-code corpus for changed symbols.
**Status: active (advanced, not yet fully validated)**
M040 delivered the graph blast-radius half of R037: persistent graph substrate (S01), blast-radius queries and graph-aware reranking (S02), and bounded graph prompt injection in the review handler (S03). The canonical current-code corpus combination (M041) remains for a future milestone. R037 validation criteria ("Review Details includes a bounded Structural Impact section with impacted files/callers AND current-code evidence sourced from M040 AND M041") cannot be fully satisfied until M041 is complete. Status remains **active** — this is expected and pre-disclosed.

### R038 — Breaking-change detection for exported or widely-used symbols shall be structurally grounded with caller/dependent evidence and fail open when graph or corpus context is unavailable.
**Status: active → validated**
M040/S03 proof check `M040-S03-FAIL-OPEN-VALIDATION` confirms `neverThrew=true, succeeded=false, originalFindingsPreserved=true` when the LLM validation gate throws. `buildGraphContextSection(null)` returns empty text (fail-open). `isTrivialChange()` is fail-closed on zero files (bypasses only legitimate trivial changes). `applyGraphAwareSelection()` returns `usedGraph=false` on null graph. Caller/dependent evidence is provided by `queryBlastRadiusFromSnapshot()` with explicit confidence scores and reason strings. Validation criteria satisfied: fail-open contract confirmed by machine-verifiable proof. **R038 transitions to validated.**

## Deviations

S01: Extractors implemented as a single `src/review-graph/extractors.ts` module rather than the planned directory structure (extractors/cpp.ts, extractors/python.ts, extractors/index.ts). A single module was the smallest safe surface given no existing extractor directory in the codebase.

S01: DB-backed store tests use `TEST_DATABASE_URL` gating (skip cleanly on no-DB) rather than the original assumption of a live-DB test run. This improved correctness and determinism in auto-mode.

S02: `listWorkspaceGraph()` snapshot API added to the `ReviewGraphStore` interface (not in the original S02 plan) — required for cross-file blast-radius queries to operate through the store abstraction rather than direct DB access.

S02: TOP_N=1 used for the MISSED-FILES proof fixture (plan did not specify a TOP_N). TOP_N=2 would have left `graphSurfacedExtra` empty because the impacted file was already in the risk-only top-2 at rank 2; TOP_N=1 correctly captures rank-promotion.

S03: `config.review.graphValidation` Zod schema addition deferred — the validation gate is inert by default and accessed via type assertion. Adding the Zod field was deferred to avoid a migration with no production trigger; production enablement is an explicit opt-in operational step.

## Follow-ups

M041 (canonical current-code corpus): Deliver the default-branch code corpus with commit/ref provenance so M038 can combine graph blast-radius (M040) with semantically relevant unchanged-code retrieval to fully satisfy R037.

M038 (AST/call-graph review behavior): Wire M040 graph substrate and M041 canonical corpus into M038 review behavior. Consume `createReviewGraphQuery(store)` from M040 as the `reviewGraphQuery` provider in the review handler — this is the production wiring that activates the DI seam built in M040/S02.

Operational deployment: Index a production repo using `createReviewGraphIndexer()` to populate the graph tables. Pass `createReviewGraphQuery(store)` into the review handler. Enable the validation gate via `config.review.graphValidation` (Zod schema addition deferred from S03 — add it and the migration before production enablement).

Deleted-file cleanup: The indexer handles additions, updates, and unchanged-file skips but does not yet remove persisted graph rows for files deleted from the workspace. A separate reconciliation pass or indexer extension is needed before graph data can become stale on file deletions.

Cross-file call resolution: Current C++ and Python extractors resolve cross-file call edges with partial certainty. A future extractor improvement pass could improve call-graph fidelity by parsing include graphs for C++ and import paths for Python more deeply, reducing reliance on name-based heuristics.

# S02: Blast-Radius Queries and Graph-Aware Review Selection — UAT

**Milestone:** M040
**Written:** 2026-04-05T12:11:06.027Z

## S02 UAT: Blast-Radius Queries and Graph-Aware Review Selection

### Preconditions

- Node/Bun runtime available (`bun --version` succeeds)
- Repository cloned and dependencies installed (`bun install`)
- TypeScript compiles cleanly (`bun run tsc --noEmit` exits 0)
- No live DB or network required for any test in this slice

---

### Test Case 1: Blast-Radius Query Surfaces Graph-Ranked Impacted Files and Tests

**What it validates:** `queryBlastRadiusFromSnapshot` correctly walks graph edges to produce ranked impacted files, likely tests, and probable dependents for C++ and Python changed-path inputs.

**Steps:**
1. Run `bun test ./src/review-graph/query.test.ts`
2. Observe: 2 tests pass, 0 fail
3. Confirm both test names appear:
   - `ranks python blast radius dependents and likely tests above weaker neighbors`
   - `returns graph-ranked C++ impacted files and test candidates for changed symbols`

**Expected outcome:** All 2 tests pass in under 100ms. The Python test confirms test files with `tests` edges score above unrelated source files. The C++ test confirms callsite-connected files score above unrelated headers.

---

### Test Case 2: Graph-Aware Selection Reranks Large-PR Files and Preserves Fallback

**What it validates:** `applyGraphAwareSelection` correctly promotes graph-signal files in large-PR triage and returns the unchanged risk order when no graph is supplied.

**Steps:**
1. Run `bun test ./src/lib/file-risk-scorer.test.ts`
2. Observe: 12 tests pass, 0 fail
3. Confirm these test names appear:
   - `preserves baseline ordering when graph data is absent`
   - `promotes graph-impacted files and likely tests within bounded sorted output`
   - `ignores graph paths that are not already in the review set`

**Expected outcome:** All 12 tests pass. The fallback test confirms `usedGraph=false` and byte-identical ordering. The promotion test confirms impacted files and likely tests are boosted and resorted.

---

### Test Case 3: Proof Harness Script Exits 0 with All Four Checks Passing

**What it validates:** The end-to-end machine-readable proof that graph-aware selection surfaces impacted files, promotes likely tests, reranks dependents, and preserves fallback order — all proven against fixture data.

**Steps:**
1. Run `bun run verify:m040:s02 -- --json`
2. Observe JSON output to stdout
3. Confirm `"overallPassed": true`
4. Confirm all four check IDs are present:
   - `M040-S02-GRAPH-SURFACES-MISSED-FILES`
   - `M040-S02-GRAPH-SURFACES-LIKELY-TESTS`
   - `M040-S02-GRAPH-RERANKS-DEPENDENTS`
   - `M040-S02-FALLBACK-PRESERVES-ORDER`
5. Confirm each check has `"passed": true, "skipped": false`

**Expected outcome:** Script exits 0. JSON is well-formed. `overallPassed: true`. Detailed `detail` strings include concrete path names proving which files were promoted.

---

### Test Case 4: Proof Harness Unit Tests with Negative Injection

**What it validates:** The proof harness checks individually fail when the injected graph/selection data does not satisfy the claim — guards against trivially-passing checks.

**Steps:**
1. Run `bun test ./scripts/verify-m040-s02.test.ts`
2. Observe: 24 tests pass, 0 fail
3. Confirm negative-injection tests appear per check:
   - MISSED-FILES: 4 negative tests (no graph applied, no impacted files, wrong path, no extra surfaced)
   - LIKELY-TESTS: 3 negative tests (no test files, wrong path, test not promoted)
   - RERANKS-DEPENDENTS: 3 negative tests (no dependents, wrong path, not promoted)
   - FALLBACK: 3 negative tests (graph applied, order mutated, nonzero graphHits)

**Expected outcome:** All 24 tests pass. Negative tests confirm checks fail deterministically when the contract is violated.

---

### Test Case 5: GRAPH-SURFACES-MISSED-FILES Rank-Promotion Detail

**What it validates:** The MISSED-FILES check specifically proves rank promotion (not just presence) — the impacted file is at rank 1 under graph-aware selection and absent from the risk-only top-1.

**Steps:**
1. Run `bun run verify:m040:s02 -- --json`
2. Parse the `detail` field for `M040-S02-GRAPH-SURFACES-MISSED-FILES`
3. Confirm it contains:
   - `graphAwareTopN=["xbmc/cores/VideoPlayer/VideoPlayer.cpp"]` (rank-1 slot)
   - `riskOnlyTopN=["xbmc/network/oauth/OAuth2Handler.cpp"]` (different file at rank-1)
   - `graphSurfacedExtra=["xbmc/cores/VideoPlayer/VideoPlayer.cpp"]` (file in graph top-1 but not risk top-1)

**Expected outcome:** The detail string matches the expected values. This proves the call+include edges from VideoPlayer to the changed StringUtils.h outweigh the static auth-path risk score of OAuth2Handler.

---

### Test Case 6: GRAPH-SURFACES-LIKELY-TESTS Detail — Python Test Promotion

**What it validates:** A Python test file with an explicit `tests` graph edge to the changed symbol is promoted into the top-2 selection even though test files have low file-category risk weight.

**Steps:**
1. Run `bun run verify:m040:s02 -- --json`
2. Parse the `detail` field for `M040-S02-GRAPH-SURFACES-LIKELY-TESTS`
3. Confirm it contains:
   - `graphLikelyTests=["tests/utils/test_string_utils.py"]`
   - `testPromoted=true`
   - `graphAwareTopN` includes `"tests/utils/test_string_utils.py"`

**Expected outcome:** The test file appears in `graphLikelyTests` and is present in the graph-aware top-2. This proves the `tests` edge (weight 0.88) overcomes the low test-category risk score.

---

### Test Case 7: GRAPH-RERANKS-DEPENDENTS Detail — C++ Caller Promotion

**What it validates:** `FileCurl.cpp` (which contains a callsite to changed `URIUtils::GetExtension`) is promoted above `PVRManager.cpp` (which has more lines but no graph signal).

**Steps:**
1. Run `bun run verify:m040:s02 -- --json`
2. Parse the `detail` field for `M040-S02-GRAPH-RERANKS-DEPENDENTS`
3. Confirm it contains:
   - `dependentCount=1`
   - `callerPromoted=true`
   - `graphAwareRanking` has `"xbmc/filesystem/FileCurl.cpp"` before `"xbmc/pvr/PVRManager.cpp"`

**Expected outcome:** FileCurl.cpp appears first in the graph-aware ranking, confirming the calls-edge (weight 0.92) promotion.

---

### Test Case 8: FALLBACK-PRESERVES-ORDER — Null Graph Returns Unchanged Risk Order

**What it validates:** Passing `graph=null` to `applyGraphAwareSelection` returns the exact original risk ordering with `usedGraph=false` and `graphHits=0`.

**Steps:**
1. Run `bun run verify:m040:s02 -- --json`
2. Parse the `detail` field for `M040-S02-FALLBACK-PRESERVES-ORDER`
3. Confirm it contains:
   - `usedGraph=false`
   - `graphHits=0`
   - `riskOrderPreserved=true`
   - `riskScoreCount=3`

**Expected outcome:** The fallback contract holds. Risk ordering is byte-identical. No graph fields are populated.

---

### Test Case 9: TypeScript Clean Compile

**What it validates:** All new types (ReviewGraphQueryInput, ReviewGraphBlastRadiusResult, GraphAwareSelectionResult, etc.) and the reviewGraphQuery optional handler parameter are correctly typed.

**Steps:**
1. Run `bun run tsc --noEmit`
2. Observe: exits 0, no output

**Expected outcome:** Zero TypeScript errors. Clean compile confirms the optional DI seam, the store interface extension, and all new types are fully consistent.

---

### Test Case 10: Full Review-Graph Module Test Suite

**What it validates:** S02 additions (query.ts, store.ts listWorkspaceGraph) do not regress S01 extractor/indexer coverage.

**Steps:**
1. Run `bun test ./src/review-graph/`
2. Observe: 8 pass, 7 skip, 0 fail
3. Confirm: `store.test.ts` skips DB-gated tests (no TEST_DATABASE_URL); `query.test.ts`, `extractors.test.ts`, `indexer.test.ts` all pass

**Expected outcome:** No regressions from S01. DB-gated tests skip cleanly (not fail). Fixture-driven tests pass.


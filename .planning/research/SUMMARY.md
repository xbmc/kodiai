# Project Research Summary

**Project:** Kodiai v0.9 -- Dependency Bump Analysis, Timeout Resilience, Intelligent Retrieval
**Domain:** AI Code Review System Enhancement
**Researched:** 2026-02-14
**Confidence:** HIGH

## Executive Summary

This milestone enhances an existing AI code review system with three independent capability areas that address current pain points. The critical finding is that **all three features leverage existing infrastructure** with minimal new dependencies. Dependency bump analysis uses Bun's native semver and the already-installed Octokit for GitHub Advisory API access. Timeout resilience builds on the existing AbortController pattern to capture partial results rather than failing completely (addressing a documented 10% failure rate on large repos). Intelligent retrieval improves the existing embedding-based learning memory through better query construction and adaptive thresholds, not by adding new models or vector databases.

The recommended approach prioritizes timeout resilience first (highest impact, lowest risk), followed by retrieval improvements (pure functions, no external APIs), then dependency bump analysis (most complex, requires external API coordination). All three features follow established patterns in the codebase: pure function enrichment, fail-open design, and config-gated progressive rollout. The architecture integrates into the existing review pipeline as preprocessing and enrichment layers—no new services, no new databases, no architectural overhaul.

The key risk is data quality for dependency analysis: changelog availability is 50-70% at best, and CVE databases have documented false positive rates approaching 20,000 entries. Mitigation requires graceful degradation (fallback URLs when changelogs unavailable), OSV.dev over raw NVD for higher-quality advisories, and framing all vulnerability data as "advisory/informational" rather than blocking. The timeout resilience risk is duplicate comment publication during chunked reviews, prevented by using progressive scope reduction (single publish point) rather than parallel chunk execution.

## Key Findings

### Recommended Stack

**Zero new npm dependencies required.** Every capability leverages existing infrastructure:

**Core technologies:**
- **Bun.semver (native)**: semver comparison and validation — 20x faster than node-semver, already in runtime
- **@octokit/rest@22.0.1**: GitHub Advisory Database API and Releases API — already installed, typed endpoints available
- **Voyage AI + sqlite-vec**: embedding generation and vector retrieval — existing learning memory stack, no changes needed
- **SQLite (bun:sqlite)**: adaptive threshold tracking and dep analysis cache — existing persistence layer
- **AbortController + MCP tools**: timeout enforcement and partial result publishing — already implemented in executor.ts

**Critical rejection:** Do NOT add `semver` npm package (50KB for one missing function), OSV-scanner (GitHub Advisory DB is upstream), BullMQ (setTimeout is sufficient), or second embedding models (Voyage AI handles multi-signal queries).

**Version compatibility:** All features compatible with existing dependency versions. No breaking changes to APIs, schemas, or data formats beyond additive tables.

### Expected Features

**Must have (table stakes):**
- **Dependency bump detection from PR metadata** — Dependabot/Renovate signal updates via title, labels, branch name; users expect recognition
- **Security advisory lookup** — GitHub Advisory API for known CVEs; CodeRabbit integrates OSV-Scanner, users expect vulnerability flagging
- **Timeout resilience with partial results** — 10% failure rate means users get zero value; partial reviews better than error comments
- **Multi-signal retrieval queries** — Current query (title + file paths) produces weak semantic matches; risk signals + language context required

**Should have (competitive):**
- **Changelog extraction with fallback** — Renovate/Dependabot embed changelogs; review tool should surface version changes
- **Merge confidence scoring** — LLM-assessed confidence based on semver + advisories + breaking changes; no competitor provides this
- **Language-aware retrieval boosting** — Python findings less relevant for Go PRs; boost same-language historical matches
- **Adaptive timeout based on PR size** — Large PRs get proportionally longer timeouts, dependency bumps get shorter

**Defer (v2+):**
- **Usage analysis** (affected API grep) — HIGH value but HIGH complexity; requires changelog parsing + workspace search
- **Chunked parallel review** — Architectural complexity with duplicate comment risk; progressive reduction simpler
- **Real-time CVE monitoring** — This is Dependabot's core product; point-in-time lookup at review time sufficient
- **Custom embedding fine-tuning** — Voyage Code 3 already trained on code; marginal improvement not worth ML infrastructure

### Architecture Approach

All three features integrate into the existing review pipeline as additional preprocessing, enrichment, and resilience layers. No new services, processes, or databases. The established fail-open pattern continues: every feature degrades gracefully on failure.

**Major components:**

1. **Dependency Bump Detector** (`src/lib/`) — Pure function analyzes changed files + diff content to detect bumps, extract versions, classify ecosystems (npm/go/rust/python). Runs after diff analysis, before prompt building. ~250 LOC + tests.

2. **Changelog Fetcher** (`src/lib/`) — Async, fail-open HTTP with multi-source cascade: GitHub Releases API → CHANGELOG.md in repo → compare URL fallback. Time-budgeted (5s total), cached per package+version. ~150 LOC + tests.

3. **Advisory Lookup** (`src/lib/`) — Async, fail-open queries to GitHub Advisory Database via existing Octokit. Returns GHSA ID, severity, patched versions. Cached 24h. ~120 LOC + tests.

4. **Timeout Partial Capture** (executor.ts modification) — Track MCP publish events during streaming. On timeout, return `published: true` if any inline comments posted. Review handler extracts findings from published comments instead of posting error. ~20 LOC change.

5. **Multi-Signal Query Builder** (`src/lib/`) — Pure function replaces naive query construction. Combines PR intent + top risk files + risk signals + language context into semantic query. ~120 LOC + tests.

6. **Adaptive Threshold Computer** (`src/lib/`) — Pure function adjusts distance threshold based on repo memory count + primary language + query context. Bounded by floor (0.1) and ceiling (0.5). ~60 LOC + tests.

**Integration point:** Review handler (`src/handlers/review.ts`) wires all features between existing pipeline stages. Dependency analysis runs post-diff-analysis. Retrieval enhancements replace current query construction. Timeout capture modifies executor result handling. Total modified: ~150 LOC in review handler.

### Critical Pitfalls

1. **Changelog fetching returns stale/wrong/no data for 30-50% of packages** — npm registry `repository` field optional/incorrect, GitHub release tags inconsistent, CHANGELOG.md formats vary wildly. **Avoid:** Multi-source cascade with compare URL fallback always available. Cache results. Time budget (2s per package, 5s total). Accept graceful degradation upfront.

2. **CVE data has massive false positive/negative rates** — Sonatype 2025 analysis: 20K false positives, 150K false negatives, 64% unscored CVEs, 6-week average NVD scoring delay. **Avoid:** Use OSV.dev (package-native identifiers), frame as "advisory" not "vulnerability detected," show confidence signals, never claim "no vulnerabilities" (say "no known advisories").

3. **Chunked review publishes duplicate comments** — Chunk 1 succeeds, chunk 2 times out, retry publishes chunk 1 again. Existing idempotency uses single reviewOutputKey, doesn't track partial states. **Avoid:** Progressive scope reduction (single publish point) instead of parallel chunks. First attempt: full+abbreviated tiers. On timeout: retry with only full tier. On second timeout: top-10 files. Preserves existing architecture.

4. **Timeout recovery races with in-flight MCP tool calls** — AbortController cancels SDK but MCP calls already dispatched may complete async. Retry starts before cleanup finishes. **Avoid:** Cooldown (5s) + idempotency check before retry. Track published comment IDs in onPublish callback. Never retry in same queue execution.

5. **Naive retrieval query produces weak semantic matches** — Current: `${pr.title}\n${reviewFiles.slice(0,20).join("\n")}` searches "file paths" against "finding descriptions" (different semantic spaces). **Avoid:** Build multi-signal queries: PR intent + language + risk signals + diff context. Example: "TypeScript authentication bug fix: error handling, null checks in auth middleware." Use existing diffAnalysis.riskSignals for semantic enrichment.

## Implications for Roadmap

Based on research, this milestone naturally decomposes into **5 phases** ordered by impact and risk:

### Phase 1: Timeout Resilience — Partial Result Capture
**Rationale:** Highest impact (addresses 10% failure rate), lowest risk (25 LOC in executor, 60 LOC in review handler), immediate measurable value. Turns total failures into graceful partial reviews.

**Delivers:** Modified executor tracks published state on timeout. Review handler extracts findings from already-published inline comments, applies full post-LLM pipeline, posts summary with "partial review" notice.

**Addresses:** Must-have timeout resilience with partial results (table stakes from FEATURES.md)

**Avoids:** Pitfall P3 (duplicate comments) by NOT implementing chunked parallel execution yet. Pitfall P4 (race conditions) by verifying idempotency before any publish.

**Stack:** Existing AbortController, MCP comment server, finding extraction pipeline (STACK.md confirms zero new dependencies)

**Research needed:** None — well-understood pattern, verified in codebase

### Phase 2: Intelligent Retrieval — Multi-Signal Queries
**Rationale:** Pure functions only, no external APIs, high leverage improvement (every retrieval benefits). Can be measured via telemetry. Independent of other features.

**Delivers:** New query builder using PR intent + top risk files + diffAnalysis.riskSignals + language. Post-retrieval language boosting for same-language findings.

**Addresses:** Must-have multi-signal queries (table stakes), should-have language-aware boosting (competitive edge)

**Avoids:** Pitfall P5 (naive queries) by enriching semantic context. Pitfall P8 (adaptive threshold unpredictability) by keeping fixed threshold for v0.9, improving queries instead.

**Stack:** Existing Voyage AI + sqlite-vec, existing diffAnalysis.riskSignals, existing language classification (STACK.md)

**Research needed:** None — extends existing patterns with known signals

### Phase 3: Dependency Bump Analysis — Detection + Advisory Lookup
**Rationale:** Foundation for all dep analysis features. Detection is pure function (zero API calls). Advisory lookup is single REST endpoint, fail-open. Delivers immediate security value before changelog complexity.

**Delivers:** Detect bumps from PR metadata + diff content. Extract package names + versions. Query GitHub Advisory API for CVEs. Inject into review prompt as dedicated section.

**Addresses:** Must-have dependency detection and security advisory lookup (table stakes)

**Avoids:** Pitfall P2 (CVE false positives) by using OSV.dev framing and confidence signals. Pitfall P11 (lock file noise) by cross-referencing manifest changes.

**Stack:** Bun.semver for version comparison, Octokit Advisory API (STACK.md confirms already available)

**Research needed:** Advisory API response format (verify GHSA structure) — LOW effort, official docs available

### Phase 4: Dependency Bump Analysis — Changelog Fetching
**Rationale:** Depends on Phase 3 detection. Higher complexity (multi-source cascade, time budgets). Lower urgency than advisory lookup.

**Delivers:** Fetch changelogs from GitHub Releases API, fallback to CHANGELOG.md, final fallback to compare URL. Cache per package+version. Time-budgeted (5s).

**Addresses:** Should-have changelog extraction (competitive feature from FEATURES.md)

**Avoids:** Pitfall P1 (changelog unreliability) by multi-source cascade with compare URL always available. Pitfall P6 (routine noise) by categorizing bumps (major gets full analysis, patch gets summary).

**Stack:** Octokit Releases API, npm registry metadata for repo URLs (STACK.md)

**Research needed:** npm registry API structure, monorepo detection heuristics — MEDIUM effort

### Phase 5: Timeout Resilience — Adaptive Timeout + Progressive Scope Reduction
**Rationale:** Depends on Phase 1 partial capture being stable. Extends timeout handling with predictive risk assessment and retry with reduced scope.

**Delivers:** Compute timeout dynamically based on file count + lines changed. On timeout, retry with reduced file set (top 50% by risk). Dependency bumps get shorter timeout (300s).

**Addresses:** Should-have adaptive timeout (competitive edge)

**Avoids:** Pitfall P14 (budget accounting) by tracking pre-executor pipeline time. Pitfall P10 (partial semantics) by adding "partial" conclusion to ExecutionResult and tracking coveredFiles.

**Stack:** Existing tieredFiles from large PR triage, existing risk scoring (STACK.md)

**Research needed:** None — extends Phase 1 patterns

### Phase Ordering Rationale

- **Independence:** All 5 phases are independent. Phases 1-2 have zero external dependencies between them. Phases 3-4 are sequential (changelog depends on detection). Phase 5 depends on Phase 1 for semantics.
- **Risk mitigation:** Start with lowest-risk (Phase 1-2) before higher-risk external API coordination (Phase 3-4).
- **Value delivery:** Phases 1-2 benefit ALL reviews. Phases 3-4 benefit only dependency-bump PRs (subset). Prioritize universal improvements.
- **Complexity gradient:** Pure functions (Phase 2) → simple modifications (Phase 1) → single API integration (Phase 3) → multi-source coordination (Phase 4) → orchestration changes (Phase 5).

### Research Flags

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** Executor modification follows existing AbortController pattern. Finding extraction already implemented.
- **Phase 2:** Query construction is pure function. Language classification already exists in diff-analysis.ts.
- **Phase 5:** Extends Phase 1 patterns. Tiered files and risk scoring already implemented.

**Phases needing validation during planning:**
- **Phase 3:** Verify GitHub Advisory API response structure (GHSA fields, severity enum values). Check rate limits for batch queries. **Effort: 1 hour, official docs available.**
- **Phase 4:** Test npm registry metadata completeness (% with `repository` field). Evaluate monorepo detection heuristics (Lerna/Nx patterns). Test CHANGELOG.md parsing on top 50 npm packages. **Effort: 3-4 hours, requires sampling.**

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | All technologies verified in codebase or official docs. Bun.semver tested in runtime. Octokit types inspected in node_modules. Zero new dependencies confirmed. |
| Features | **HIGH** | Table stakes validated against Dependabot/Renovate/CodeRabbit feature sets. xbmc reference PR analyzed for dep bump patterns. 10% timeout failure rate from internal telemetry. |
| Architecture | **HIGH** | Full review pipeline analyzed (2340 LOC in review.ts). Executor timeout mechanism verified. Retrieval query construction located at line 1431. Integration points identified with LOC estimates. |
| Pitfalls | **HIGH** | Changelog reliability from Renovate docs. CVE false positives from Sonatype 2025 research (20K FP documented). Duplicate comment risk from existing idempotency implementation analysis. |

**Overall confidence:** HIGH

### Gaps to Address

- **npm registry metadata completeness:** What % of packages have valid `repository` field? What % are monorepos? — **Handle:** Sample top 100 npm packages during Phase 4 planning. Design fallback strategy (compare URL) before implementation.

- **OSV.dev API response latency:** GitHub Advisory API uses standard REST limits (5000/hr). What is typical response time for 10 package queries? — **Handle:** Test during Phase 3 planning. Set 2s per-package timeout if latency exceeds 500ms.

- **Retrieval quality measurement:** How to quantify "better queries" beyond distance thresholds? — **Handle:** Add telemetry during Phase 2: track whether retrieved findings appear in same category/severity as actual findings. Target >40% category match rate.

- **Partial review coverage tracking:** How to store which files were reviewed in timeout-partial cases for incremental diff? — **Handle:** Design `coveredFiles` field in knowledge store during Phase 1 planning. Extends existing review record schema.

- **Embedding model drift detection:** How often to sample for drift? What distance threshold indicates drift? — **Handle:** Defer to post-v0.9 monitoring. Phase 2 implementation pins model version explicitly. Weekly sampling suggested but not required for launch.

## Sources

### Primary (HIGH confidence)
- Kodiai codebase: `src/handlers/review.ts` (2340 LOC, full pipeline), `src/execution/executor.ts` (256 LOC, timeout), `src/learning/isolation.ts` (128 LOC, retrieval), `src/execution/diff-analysis.ts` (366 LOC, risk signals), `src/learning/memory-store.ts` (349 LOC, vec0)
- [GitHub Advisory Database REST API docs](https://docs.github.com/en/rest/security-advisories/global-advisories) — `GET /advisories` with ecosystem/affects filters
- [Bun Semver API Reference](https://bun.com/reference/bun/semver) — `order()` and `satisfies()` only; NO `diff()` method
- [Sonatype: The CVE Crisis (2025)](https://www.sonatype.com/resources/research/the-cve-crisis) — 20K false positives, 150K false negatives documented
- `.planning/xbmc_deep_analysis.md` — 10% timeout failure rate internal data

### Secondary (MEDIUM confidence)
- [Renovate changelog extraction docs](https://docs.renovatebot.com/key-concepts/changelogs/) — GitHub Releases + CHANGELOG.md parsing strategy
- [Dependabot compatibility score](https://github.com/dependabot/dependabot-core/issues/4001) — CI pass rate methodology
- [CodeRabbit architecture (Google Cloud)](https://cloud.google.com/blog/products/ai-machine-learning/how-coderabbit-built-its-ai-code-review-agent-with-google-cloud-run) — 3600s timeout, buffered output
- [OSV.dev: Disputed CVE fix (2025)](https://socket.dev/blog/google-osv-fix-adds-500-new-advisories) — 500+ advisories restored, data quality improvements

### Tertiary (LOW confidence)
- [ScienceDirect: Trust tests for dependency updates?](https://www.sciencedirect.com/science/article/pii/S0164121221001941) — 47% direct fault detection via tests
- RAG Techniques Repository (GitHub) — multi-signal query patterns, hybrid retrieval (general-purpose, adapted for code review)

---
*Research completed: 2026-02-14*
*Ready for roadmap: yes*
*Estimated total implementation: ~1,250 LOC new + ~310 LOC modifications + ~1,230 LOC tests*

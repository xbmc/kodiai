# Project Research Summary

**Project:** Kodiai v0.10 -- Advanced Signals (Usage-Aware Analysis, Trend Tracking, Checkpoint Publishing, Adaptive Retrieval, Cross-Language Equivalence)
**Domain:** AI-powered code review bot with advanced dependency analysis and intelligent knowledge retrieval
**Researched:** 2026-02-15
**Confidence:** HIGH

## Executive Summary

This milestone adds six capability areas to an existing, mature AI code review bot. The research reveals a well-defined technical path: one new dependency (`@ast-grep/napi` for AST-based code analysis), five pure-function implementations (Kneedle algorithm, recency decay, cross-language mapping, SQL-based trend queries, checkpoint timers), and extensions to existing SQLite tables. The codebase already has the infrastructure needed: workspace cloning, dependency detection, knowledge store with vector search, LLM execution with MCP tools, and timeout estimation.

The recommended approach extends existing pipeline stages rather than adding new subsystems. API usage analysis runs in parallel with changelog fetching (Stage 2), dependency history writes alongside review recording (Stage 6), adaptive thresholds adjust merge confidence (Stage 3), and recency weighting chains into the existing retrieval reranker (Stage 4). Checkpoint publishing introduces a new MCP tool that Claude invokes during execution to save partial results, while timeout retry re-enters the pipeline through the existing job queue. Every integration point is fail-open: errors degrade context quality but never block reviews.

Key risks center on false positives from AST analysis (test files contaminating usage data), orphaned checkpoint comments on timeout (partial publish without summary context), infinite retry loops (no cap on retries), and adaptive threshold instability with small sample sizes (knee-point detection on fewer than 10 results is numerically meaningless). Each risk has a proven mitigation: file exclusion lists, buffer-and-flush publish architecture, hard retry caps, and minimum sample size guards. The existing codebase patterns (fail-open enrichment, Promise.allSettled parallelism, SQLite table extensions, MCP tool registration) provide architectural templates that minimize risk when followed consistently.

## Key Findings

### Recommended Stack

The technology decision is lean: add `@ast-grep/napi` for structural code search, keep everything else. AST-grep provides tree-sitter-based pattern matching across languages (TypeScript, JavaScript, Python, Go, Rust, Java) with a high-level query API, avoiding the need for separate tree-sitter grammar packages. Bun v1.1.34+ supports the required NAPI bindings. For languages without AST grammar support, fall back to Bun's built-in shell with `grep -rn`.

**Core technologies:**
- **@ast-grep/napi (v0.40.x)**: AST-level API usage detection in cloned workspaces — chosen over raw tree-sitter for bundled grammars and higher-level pattern API
- **SQLite with window functions**: Dependency bump history and trend queries — existing knowledge store extended with new tables, no new database
- **Pure TypeScript implementations**: Kneedle algorithm (~60 LOC), recency decay (~20 LOC), cross-language concept map (~180 LOC) — no npm libraries exist for these, algorithms are straightforward to port
- **MCP tool for checkpoints**: Save partial results during execution — follows existing pattern from comment-server.ts and inline-review-server.ts
- **Existing stack (no changes)**: bun:sqlite, sqlite-vec, voyageai, @octokit/rest, zod, pino, p-queue, picomatch

### Expected Features

Research categorizes nine features into table stakes (natural extensions of existing v0.9 capabilities), differentiators (competitive advantages), and anti-features (explicitly avoid).

**Must have (table stakes):**
- **API usage analysis**: Grep workspace for imports of bumped package and cross-reference with breaking changes — without this, breaking change warnings are generic ("this package has breaking changes") rather than specific ("you import foo.bar() at src/auth.ts:42 which was removed in v3")
- **Dependency history tracking**: Record package bumps in knowledge store with merge confidence and security context — enables trend queries ("lodash updated 45 days ago with no issues") that provide longitudinal context
- **Checkpoint accumulation**: Track files analyzed and findings generated during execution — infrastructure for both enriched timeout messages and retry with reduced scope
- **Retrieval quality telemetry**: Log metrics per execution (result count, avg distance, threshold used, language matches) — establish baseline before any retrieval changes

**Should have (competitive):**
- **Multi-package correlation**: Detect grouped scope-prefix updates (@babel/core + @babel/parser) and note coordination — fills gap in existing isGroup handling
- **Recency weighting**: Exponential decay on older retrieval results (half-life 90 days default) — simple math in existing reranking pipeline
- **Adaptive distance thresholds**: Replace fixed 0.3 threshold with max-gap detection — data-driven cutoff that self-tunes per query
- **Retry with reduced scope**: Auto-retry timed-out reviews with top-N files by risk score — transforms zero-value timeout into partial review

**Defer (v2+):**
- **Cross-language concept normalization**: Lookup table mapping equivalent patterns (TypeScript .map() ↔ Python list comprehension) — conditional on testing whether Voyage Code 3 already handles cross-language retrieval natively
- **Retrieval-to-outcome correlation**: Post-review analysis comparing retrieved memories to produced findings — requires baseline data first

### Architecture Approach

All nine features integrate into existing pipeline stages. No new services, databases, or runtime processes. The review pipeline has six stages (workspace setup, detection, enrichment, retrieval, execution, post-processing) and features plug into specific stages as fail-open extensions.

**Major components:**
1. **dep-bump-usage-analyzer.ts** (new) — Runs in Stage 2 parallel with fetchSecurityAdvisories and fetchChangelog, uses workspace.dir to grep for imports, produces usage evidence that feeds into merge confidence and review prompt
2. **dep_bump_history table** (new table in existing knowledge store) — Written in Stage 6 after recordReview, queried in Stage 3 for threshold calibration, indexed on (repo, package_name, created_at)
3. **checkpoint-server.ts MCP tool** (new) — Registers with executor in Stage 5, allows Claude to save partial results during execution, writes to review_checkpoints table, read by retry logic on timeout
4. **Retrieval pipeline extensions** (modify existing retrieval-rerank.ts) — applyRecencyWeight() chains after rerankByLanguage(), adaptive threshold replaces fixed 0.3 in isolation.ts, cross-language concept map augments buildRetrievalQuery()
5. **Retry via job queue** (extend review handler) — On timeout with no published output, re-enqueue with retry metadata (checkpoint data, reduced scope, smaller timeout), uses existing PQueue concurrency control

### Critical Pitfalls

Research identifies thirteen pitfalls across critical/moderate/minor severity. The critical five require design-time prevention.

1. **API usage analysis false positives from test/dead code** — Naive grep in large repos matches 200+ test files; prevention: two-phase approach (regex for imports, optional AST for API calls), exclude test/*, 3-second time budget, cache results per workspace
2. **Schema migration corrupts SQLite databases** — Adding columns to existing tables risks partial migration failures; prevention: additive-only schema (new tables not column changes), all DDL in single transaction, test against production data dump before deploy
3. **Checkpoint publishing orphans partial comments on timeout** — Publishing inline comments incrementally leaves orphaned findings when review times out; prevention: buffer-and-flush architecture (accumulate in memory, publish all at once on checkpoint or completion), never publish inline without summary context
4. **Timeout retry creates infinite loops** — Scope reduction doesn't guarantee success, each retry costs $0.10-$2.00 in LLM tokens; prevention: hard cap of 1 retry maximum, retry uses smaller timeout (half of original), no retry for repos with 3+ recent timeouts
5. **Adaptive thresholds unstable with small samples** — Knee-point detection on fewer than 10 results is numerically meaningless, threshold oscillates between reviews; prevention: require minimum 8 candidates for knee-point, percentile fallback for small samples, floor 0.15 / ceiling 0.65

## Implications for Roadmap

Based on research, recommend four-phase structure matching dependency layers and risk profiles.

### Phase 1: Foundation Layer (Data Infrastructure)
**Rationale:** New tables, type extensions, and utility modules with no pipeline changes — lowest risk starting point that creates infrastructure for later phases
**Delivers:** dep_bump_history table, retrieval telemetry fields in TelemetryRecord, cross-language equivalence lookup table (JSON with 20 high-confidence mappings)
**Addresses:** Dependency history tracking (table stakes), retrieval quality telemetry (table stakes), cross-language concept map (differentiator)
**Avoids:** Schema migration corruption (P2) — use additive-only pattern, test against prod data
**Research flag:** NO — SQLite table creation is well-documented pattern already used in codebase

### Phase 2: Analysis Extensions (Pipeline Enrichment)
**Rationale:** New analysis modules that plug into existing pipeline stages as fail-open enrichment — builds on foundation layer infrastructure
**Delivers:** API usage analyzer (grep imports + optional AST), multi-package correlator (scope-based grouping), recency weighting in retrieval reranker
**Addresses:** API usage analysis (table stakes, highest user value), multi-package correlation (table stakes), recency weighting (differentiator)
**Avoids:** Usage analysis false positives (P1) — file exclusion, time budget, two-phase approach; multi-package over-grouping (P6) — scope-based not name-based; recency forgets old patterns (P7) — severity-aware decay
**Research flag:** LIGHT for Phase 2.1 (usage analysis) — need to verify @ast-grep/napi integration with Bun, confirm NAPI compatibility; NO for Phase 2.2 (correlation) and Phase 2.3 (recency)

### Phase 3: Intelligence Layer (Adaptive Behavior)
**Rationale:** Adaptive thresholds consume dep history from Phase 1, require telemetry baseline from Phase 1 to validate improvement
**Delivers:** Adaptive distance threshold with max-gap detection (replaces fixed 0.3), calibrated merge confidence adjustments based on historical dep bump data
**Addresses:** Adaptive thresholds (differentiator), usage analysis in merge confidence (table stakes follow-up from Phase 2)
**Avoids:** Adaptive threshold instability (P5) — minimum 8 candidates, percentile fallback, floor/ceiling guards
**Research flag:** NO — Kneedle algorithm well-documented, implementation straightforward, edge cases enumerated in research

### Phase 4: Resilience Layer (Execution Hardening)
**Rationale:** Checkpoint and retry are the most complex integration points (MCP tool registration, job queue re-entry, idempotency) — benefit from all other features being stable
**Delivers:** Checkpoint MCP tool (save partial results during execution), enriched timeout summary (uses checkpoint data), retry with reduced scope (re-enters pipeline via queue)
**Addresses:** Checkpoint accumulation and timeout retry (both table stakes for execution resilience)
**Avoids:** Orphaned checkpoint comments (P3) — buffer-and-flush architecture; infinite retry loops (P4) — max 1 retry, smaller timeout on retry
**Research flag:** MODERATE for Phase 4.1 (checkpoint MCP tool) — verify MCP tool registration pattern, test buffer-and-flush with existing onPublish callback; LIGHT for Phase 4.2 (retry) — job queue re-entry pattern needs validation

### Phase Ordering Rationale

- **Foundation before analysis**: Tables must exist before analysis modules write to them (dep_bump_history created in Phase 1, written in Phase 2)
- **Analysis before intelligence**: Adaptive thresholds calibrate from historical data (Phase 2 starts writing history, Phase 3 consumes it after baseline accumulates)
- **Intelligence before resilience**: Retry should use adaptive thresholds not fixed thresholds (Phase 3 stabilizes retrieval before Phase 4 adds retry complexity)
- **Checkpoint before retry**: Retry reuses checkpoint data (Phase 4.1 creates checkpoint infrastructure, Phase 4.2 consumes it)
- **Telemetry early**: Phase 1 ships telemetry to collect baseline metrics before Phase 3 changes retrieval behavior

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2.1 (API usage analysis)**: Verify @ast-grep/napi NAPI compatibility with Bun 1.1.34+, test AST pattern matching accuracy, confirm fallback to grep works across ecosystems (npm/PyPI/Go modules/Cargo)
- **Phase 4.1 (Checkpoint MCP tool)**: Validate MCP tool registration with executor, test buffer-and-flush with existing onPublish callback, verify checkpoint data serialization/deserialization

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation)**: SQLite table creation, type extensions, and static lookup tables follow existing codebase patterns exactly
- **Phase 2.2/2.3 (Correlation, Recency)**: Pure logic extensions of existing modules with no new infrastructure
- **Phase 3 (Adaptive thresholds)**: Kneedle algorithm implementation verified in research, SQL calibration queries are standard window functions
- **Phase 4.2 (Retry)**: Job queue re-entry follows existing review handler pattern, reduced scope uses existing file-risk-scorer.ts

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | @ast-grep/napi verified compatible with Bun NAPI support added in v1.1.34, all other implementations use existing dependencies or pure TypeScript, no unproven technologies |
| Features | MEDIUM-HIGH | Feature categorization based on codebase analysis (existing v0.9 capabilities verified) and competitor analysis (Aikido, Renovate patterns validated), cross-language equivalence has lower confidence (no authoritative mapping source) |
| Architecture | HIGH | All nine integration points verified against actual codebase modules (review.ts 2500+ lines analyzed, knowledge/store.ts schema confirmed, execution/executor.ts MCP pattern confirmed), integration decisions match existing patterns |
| Pitfalls | HIGH | All critical pitfalls verified against codebase constraints (SQLite schema patterns, executor timeout architecture, job queue concurrency model, retrieval threshold filtering), preventions tested against existing guard rails |

**Overall confidence:** HIGH

### Gaps to Address

Areas where research was inconclusive or needs validation during implementation:

- **Cross-language equivalence quality**: Static lookup table approach is sound, but the equivalence mapping itself (which packages are truly equivalent across ecosystems) requires empirical validation. Start with 20 high-confidence mappings, expand based on telemetry showing cross-language retrieval actually improves review quality.
- **Knee-point vs max-gap simplification**: Research recommends simplified max-gap detection over full Kneedle algorithm for small result sets (typical retrieval returns 5-20 candidates). Validate that max-gap produces stable thresholds before investing in full Kneedle implementation.
- **Checkpoint publish timing**: Research recommends buffer-and-flush, but the optimal checkpoint frequency (every 5 findings? every 30 seconds? on natural phase boundaries?) needs empirical testing. Start conservative (checkpoint once at 70% of timeout budget), tune based on timeout recovery success rate.
- **Usage analysis performance budget**: 3-second time budget is recommended but needs validation against real repo sizes. Large monorepos (10K+ source files) may need tighter budget or more aggressive file filtering. Collect telemetry on analysis duration per repo complexity tier.

## Sources

### Primary (HIGH confidence)
- Kodiai codebase analysis: src/handlers/review.ts (full pipeline), src/knowledge/store.ts (schema), src/learning/* (retrieval), src/execution/executor.ts (MCP), src/lib/dep-bump-*.ts (existing detection), src/telemetry/store.ts (WAL patterns), src/jobs/queue.ts (PQueue concurrency)
- @ast-grep/napi npm documentation — v0.40.5, NAPI bindings, language support matrix
- Bun v1.1.34 release notes — tree-sitter NAPI compatibility fix (napi_type_tag_object support)
- SQLite window functions documentation — LAG, AVG OVER, julianday() support confirmed
- Kneedle algorithm paper (Satopaa et al.) — "Finding a Kneedle in a Haystack"

### Secondary (MEDIUM confidence)
- Aikido Security Upgrade Impact Analysis — codebase usage analysis for breaking changes, three-bucket classification
- Renovate Dependency Dashboard — groupName configuration for monorepo ecosystems, update frequency tracking
- Python kneed library (reference implementation) — validates max-gap simplified approach for small result sets
- Re3: Relevance & Recency Retrieval (2025 framework) — exponential decay model for temporal information retrieval
- RAG evaluation metrics literature — Precision@K, distance distribution monitoring, contextual relevance

### Tertiary (LOW confidence)
- Cross-language package equivalence — no authoritative cross-ecosystem mapping database exists; manual curation recommended based on absence of viable alternatives
- sqlite-vec performance with WAL contention — exact KNN performance documented, but real-world behavior under concurrent writes needs empirical validation in Kodiai's Azure Container Apps deployment

---
*Research completed: 2026-02-15*
*Ready for roadmap: yes*

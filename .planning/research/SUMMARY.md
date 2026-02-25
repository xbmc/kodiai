# Project Research Summary

**Project:** Kodiai v0.19 Intelligent Retrieval Enhancements
**Domain:** AI code review bot — retrieval quality, specialized review pipelines, CI analysis
**Researched:** 2026-02-25
**Confidence:** HIGH

## Executive Summary

Kodiai v0.19 is an enhancement milestone, not a greenfield build. All four features extend an existing, production AI code review pipeline that already has: hybrid BM25+vector cross-corpus retrieval, language-aware re-ranking, dependency bump detection, and a CI status MCP tool. The recommended approach is zero new dependencies — every capability can be implemented with the current runtime (Bun, Hono, postgres.js, pgvector, Voyage AI, Octokit, Anthropic SDK). The biggest architectural decision is whether language boosting lives in the legacy retrieval path or the unified cross-corpus pipeline; research strongly recommends keeping them separate to avoid a double-boost bug that would distort cross-corpus balance.

The four features fall into two risk tiers. Low-to-medium risk: language-aware schema extension (a well-understood migration + backfill), CI failure recognition (deterministic heuristics using the Checks API, not the Actions API), and the `[depends]` PR deep review pipeline (Kodi-specific but builds directly on existing dep-bump infrastructure). High risk: hunk-level code snippet embedding, which is explicitly marked exploratory in issue #42 — it introduces new Voyage AI embedding cost, significant storage growth, and RRF corpus imbalance concerns if implemented naively. Hunk embedding should ship last, behind a feature flag, with cost validation before enabling by default.

The dominant risk across all features is CI failure attribution. Confidently declaring a CI failure "unrelated to this PR" requires comparing head-commit CI status against base-branch CI status, and using the Checks API (which covers all CI systems including external integrations) rather than the Actions API (GitHub Actions only). Skipping base-branch comparison turns attribution from signal into noise. All attribution output must be labeled with confidence level and must never gate or change merge verdicts.

## Key Findings

### Recommended Stack

This milestone requires zero new npm dependencies. The existing stack handles every technical requirement: postgres.js for the migration and backfill, Voyage AI (`voyage-code-3`) for any hunk embedding, Octokit (`@octokit/rest ^22.0.1`) for all GitHub API calls including the Checks API, and the existing Anthropic agent SDK for Claude-assisted changelog summarization. The only infrastructure changes are database schema: migration 007 adds a `language TEXT` column to `learning_memories`, and an optional migration 008 creates a `code_snippets` table (only if hunk embedding proceeds). See `STACK.md` for full dependency analysis.

**Core technologies:**
- **postgres.js + pgvector**: Schema extension and language-filtered vector queries — already handling all retrieval; `WHERE language = $lang` with increased `hnsw.ef_search` is sufficient at current data scale; no new database or cache layer needed
- **Voyage AI (voyage-code-3)**: Hunk-level embedding — 32K token context, 1024-dim output, designed for code-to-code retrieval; no alternative embedding provider needed
- **@octokit/rest**: CI failure recognition — `checks.listForRef` and `checks.listAnnotations` endpoints are available in v22.0.1; `checks:read` GitHub App permission needs verification (likely already granted)
- **@anthropic-ai/claude-agent-sdk**: `[depends]` changelog summarization — existing agent loop handles deep analysis of upstream changelogs within the review pipeline

**Database migrations needed:**

| Migration | Purpose |
|-----------|---------|
| 007-language-column.sql | Add `language TEXT` to `learning_memories`, add index, backfill via application code |
| 008-code-snippets.sql (conditional) | New `code_snippets` table for hunk-level embeddings; create only if Phase 4 proceeds |

### Expected Features

All four features are explicitly specified in issue #42, with concrete real-world examples from xbmc/xbmc PRs. See `FEATURES.md` for full analysis including complexity estimates, LOC projections, and feature dependency graph.

**Must have (table stakes):**
- **Language-aware retrieval boosting (schema extension)** — existing `rerankByLanguage()` re-derives language at query time from file path; storing it as a DB column is an overdue correctness fix that eliminates runtime re-classification and improves retrieval quality for all other features
- **`[depends]` PR deep review pipeline** — Kodi-specific dep bump convention (`[depends]`, `[Windows]`, etc.) is currently invisible to the bot; these PRs update C/C++ libraries compiled from source, have the highest blast radius of any PR type, and need MORE thorough review, not less
- **CI failure recognition** — direct user feedback from xbmc/xbmc#27884: maintainers waste time investigating CI failures unrelated to their PR changes; annotating with base-branch comparison reasoning unblocks legitimate merges

**Should have (differentiator):**
- **Code snippet embedding (hunk-level granularity)** — sub-function semantic retrieval demonstrably outperforms file-level retrieval per ContextCRBench (2025) and Greptile research; however it is marked exploratory in issue #42 and should not block the other three features

**Defer (v2+):**
- **Historical hunk backfill** — hunk embeddings become semantically stale as code evolves; only embed hunks from PRs where findings were produced; historical backfill has poor ROI
- **Tree-sitter / full AST parsing** — file-extension language classification is sufficient for v0.19 boosting; AST-level analysis is a future enhancement
- **Auto-merge, CI auto-retry, real-time CI monitoring** — Kodiai is a reviewer, not an operator; these cross the trust boundary and are explicitly anti-features

### Architecture Approach

v0.19 extends the existing six-stage review pipeline (workspace, diff+detection, enrichment, retrieval, prompt assembly, execution) without adding new services, databases, or runtime processes. Three features are modifications to existing components; only `[depends]` deep review introduces substantial new logic (~5 new modules). The governing design principle continues: fail-open enrichment stages that add context without blocking the pipeline. New enrichment stages wrap in `try/catch` returning null on failure; independent enrichments run via `Promise.allSettled`. See `ARCHITECTURE.md` for full integration maps, data flows, and recommended code patterns.

**Major components:**

1. **Migration 007 + memory-store.ts + retrieval-rerank.ts** — schema extension for language metadata; write path populates `language` column via `classifyFileLanguage()` at INSERT time; reranker uses stored column instead of runtime re-derivation; backfill runs as a separate application-level script
2. **detectDependsPrefix() + depends-deep-review.ts + 4 supporting modules** — new detection path for Kodi-convention dep bumps, strictly mutually exclusive with existing Dependabot/Renovate pipeline; feeds a specialized prompt section with version diff, changelog highlights, impact assessment, hash verification, and action items
3. **ci-failure-analyzer.ts + modified ci-status-server.ts** — post-review CI annotation step using Checks API (not Actions API); base-branch comparison is the mandatory primary signal for "unrelated" classification; runs after Claude execution completes, posts a separate comment (not injected into review prompt)
4. **hunk-embedder.ts + code-snippet-store.ts + code_snippets table** — exploratory fourth corpus in cross-corpus RRF; must use a separate table (never mix into `learning_memories`); ship behind `.kodiai.yml` feature flag; cap at 20 hunks/PR; TTL-expire after 90 days

### Critical Pitfalls

Full analysis of 10 pitfalls (5 critical, 5 moderate) in `PITFALLS.md`. The five that could cause architectural rework or incorrect reviews if not addressed before implementation:

1. **Double language boost in dual retrieval paths** — `rerankByLanguage()` already adjusts distances on code-corpus results before they enter unified cross-corpus RRF; adding language boosting to the unified pipeline too causes double-application for code results, distorting cross-corpus balance. Prevention: keep the legacy boost path and extend it to use the stored `language` column; do not add a second boost layer in the unified pipeline.

2. **CI failure recognition using Actions API instead of Checks API** — `ci-status-server.ts` currently uses `listWorkflowRunsForRepo` (GitHub Actions only); xbmc/xbmc uses external CI that reports via the Checks API. Building CI recognition on the wrong API means external failures are invisible. Prevention: use `checks.listForRef` as primary data source for CI status; `listWorkflowRunsForRepo` is supplementary for step-level detail on Actions runs only.

3. **`[depends]` pipeline colliding with existing dep-bump pipeline** — a single PR could match both detectors, producing two review comments with conflicting advice. Prevention: make detection strictly sequential with mutual exclusivity; `detectDepBump()` fires first; `detectDependsPrefix()` is the fallback and only fires if the former returns null. Never run both.

4. **Hunk embedding storage and cost explosion** — hunks are ephemeral diff snapshots, not stable code patterns; at 75 hunks/PR at typical PR volume, storage and Voyage API costs grow 2-3x without mitigation. Prevention: ship behind feature flag (`retrieval.hunkEmbedding.enabled: false`); only embed hunks from PRs that produced findings; TTL-expire after 90 days; cap at 20 hunks/PR; monitor Voyage token usage in telemetry separately from finding embeddings.

5. **CI failure "unrelated" attribution without base-branch comparison** — step-name and file-scope heuristics are unreliable without a full transitive dependency graph. Prevention: base-branch comparison is the minimum viable signal — check whether the same check failed on the base branch's HEAD commit; "pre-existing failure on base" is HIGH-confidence unrelated; "new failure on this PR" is UNKNOWN. Never assert "unrelated" definitively without base-branch data.

## Implications for Roadmap

Research produces a clear phase order based on dependency graph, risk profile, and feature value. All four research files independently converge on the same ordering.

### Phase 1: Language-Aware Retrieval Boosting
**Rationale:** Smallest change (one migration, two module modifications), validates the schema extension pattern used by Phase 4, and improves retrieval quality for all subsequent phases — especially Phase 2's C/C++ context retrieval. Zero UX risk: no visible behavior change, only improved result relevance.
**Delivers:** `language TEXT` column on `learning_memories`, application-level backfill script, updated write path in `memory-store.ts`, modified `retrieval-rerank.ts` to use stored language column.
**Addresses:** Language-aware boosting (table stakes)
**Avoids:** Double-boost pitfall (Pitfall 1) — must decide on unified vs. legacy path before writing any code; migration lock pitfall (Pitfall 6) — additive-only migration, backfill as separate script; wiki language gap (Pitfall 10) — design `getLanguages(chunk)` interface for all three corpora before implementation
**Needs research-phase:** No — well-understood schema migration and rerank modification; codebase analysis has confirmed all integration points.

### Phase 2: `[depends]` PR Deep Review Pipeline
**Rationale:** Highest-value feature (issue #42 explicitly states these PRs need MORE thorough review); benefits from language boosting being in place for C/C++ context retrieval. The enrichment and detection architecture is well-understood from the existing dep-bump infrastructure.
**Delivers:** `detectDependsPrefix()` regex extension, `depends-deep-review.ts` orchestrator, `depends-changelog-fetcher.ts` (upstream C/C++ repos), `depends-impact-analyzer.ts` (Kodi consumer grep), `depends-build-verifier.ts` (hash/URL/patch verification), specialized deep review prompt section in `review-prompt.ts`.
**Implements:** Detection cascade pattern (mutually exclusive with existing dep-bump pipeline); fail-open parallel enrichment via `Promise.allSettled`
**Avoids:** Dual pipeline trigger (Pitfall 3); rate limit exhaustion on multi-package PRs (Pitfall 8 — cap changelog fetching at 5 packages, 5-second total timeout)
**Needs research-phase:** Possibly — Kodi-specific `tools/depends/` build system patterns and resolution of C/C++ library names to upstream GitHub repos may need a targeted spike on the xbmc/xbmc repo before writing implementation plans.

### Phase 3: CI Failure Recognition
**Rationale:** Direct response to documented user feedback; independent of retrieval changes and can parallelize with Phase 2 if capacity allows. Simpler codebase footprint than Phase 2. Post-review annotation pattern keeps CI analysis decoupled from the review pipeline's token budget.
**Delivers:** `ci-failure-analyzer.ts` with base-branch comparison heuristic, modified `ci-status-server.ts` using Checks API, post-review annotation posting CI status note as a separate comment.
**Avoids:** Wrong CI API (Pitfall 4 — must use `checks.listForRef`, not `listWorkflowRunsForRepo`); false attribution (Pitfall 5 — base-branch comparison is mandatory minimum, not optional); CI latency on clean PRs (Pitfall 9 — trigger from `check_suite.completed` webhook or gate pre-fetch on failure detection)
**Needs research-phase:** No — Octokit Checks API is fully documented; heuristic classification is deterministic; base-branch comparison is a standard pattern. The challenge is conservative scoping (hedge language, not assertions).

### Phase 4: Code Snippet Embedding (Exploratory)
**Rationale:** Explicitly deferred last because it is marked exploratory in issue #42, has the highest cost and risk, and depends on the language column pattern validated in Phase 1. Ship as a feature-flagged spike to measure retrieval quality improvement before committing to full pipeline.
**Delivers:** `hunk-embedder.ts` (diff parsing + chunking), `code-snippet-store.ts` (CRUD + vector search), migration 008 (`code_snippets` table), `"code_snippet"` source type in `cross-corpus-rrf.ts`, `retrieval.hunkEmbedding.enabled` feature flag in `.kodiai.yml`.
**Avoids:** Storage explosion (Pitfall 2 — only embed from PRs with findings, TTL expiry, 20-hunk cap, Voyage cost telemetry); RRF corpus imbalance (Pitfall 7 — separate table with capped per-corpus contribution, never mix into `learning_memories`)
**Needs research-phase:** Yes — validate Voyage AI cost projections against actual xbmc/xbmc PR volume (hunks/PR, PRs/month) and measure retrieval quality delta against Phase 1 baseline before committing to default-enabled behavior.

### Phase Ordering Rationale

- **Phase 1 before Phase 2:** C/C++ code memory retrieval for `[depends]` PRs is more precise when the `language` column is populated; Phase 2 benefits from running on a language-enriched corpus from day one.
- **Phase 1 before Phase 4:** The `code_snippets` table follows the same language column pattern validated in Phase 1; doing Phase 4 first would require designing the pattern twice.
- **Phase 2 and 3 are independent:** They share no module boundaries and can parallelize if two developers are available.
- **Phase 4 last:** Exploratory by definition. Phases 1-3 deliver production value; Phase 4 is validated only after those are stable and after cost/quality data is available.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (`[depends]` deep review):** Kodi-specific `tools/depends/` directory structure, CMake dependency manifest naming conventions, and resolution of C/C++ library names (e.g., "zlib", "fstrcmp") to upstream GitHub repos. A one-session spike on the xbmc/xbmc repo before writing Phase 2 implementation plans is strongly recommended.
- **Phase 4 (hunk embedding):** Voyage AI cost projections need validation against real xbmc/xbmc PR volume. Retrieval quality delta should be measured against a Phase 1 baseline before committing to default-on behavior. Write an explicit success criterion (e.g., "top-5 precision improves by X%") before starting implementation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (language schema):** Additive migration + application-level backfill is a well-established pattern; the codebase already has `review-comment-backfill.ts` as the exact template.
- **Phase 3 (CI failure recognition):** Octokit Checks API is fully documented and verified; base-branch comparison is standard; heuristic logic is deterministic and testable.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All integration points verified against actual codebase; Octokit API types confirmed; Voyage AI specs confirmed from official docs; zero new dependencies validated by feature-by-feature analysis |
| Features | HIGH | Features derived directly from issue #42 with concrete xbmc/xbmc PR examples; existing capability gaps confirmed by codebase inspection; exploratory status of hunk embedding explicit in source |
| Architecture | HIGH | Based on direct codebase analysis of all six integration modules; data flows traced end-to-end; anti-patterns documented with rationale |
| Pitfalls | HIGH | All 10 pitfalls verified against actual code in retrieval.ts, retrieval-rerank.ts, cross-corpus-rrf.ts, dep-bump-detector.ts, ci-status-server.ts; recovery strategies included |

**Overall confidence:** HIGH

### Gaps to Address

- **Kodi `tools/depends/` build system structure:** Phase 2 detection and impact analysis needs a brief spike on the xbmc/xbmc repo to understand: how many `[depends]` PRs appear per month, what the CMakeLists.txt / `.cmake` file naming patterns look like, and how Kodi records upstream URLs and hashes (likely per-library `.cmake` files in `tools/depends/target/`). Address during Phase 2 planning before writing implementation steps.
- **`checks:read` GitHub App permission:** STACK.md notes this is "likely already granted" but not confirmed. Verify before Phase 3 implementation — if not granted, an App manifest update and re-installation may be required, which has operational lead time.
- **Language coverage for review comments and wiki pages:** Pitfall 10 identifies that wiki pages have no file paths for language classification. Phase 1 planning must define the `getLanguages(chunk)` interface and implement it for all three corpora (learning memories, review comments, wiki), not just learning memories. The wiki implementation (topic-based language affinity tags) requires deciding how to populate a `languages TEXT[]` column on existing wiki rows.
- **Hunk embedding cost baseline:** Phase 4 planning must begin with a cost estimation pass — count average hunks/PR and PRs/month on xbmc/xbmc to project monthly Voyage API token usage. Establish a numeric success criterion for retrieval quality improvement before writing implementation plans.

## Sources

### Primary (HIGH confidence)
- Issue #42: v0.19 Intelligent Retrieval Enhancements — feature requirements and acceptance criteria
- xbmc/xbmc#27884 — direct user feedback (garbear) driving CI failure recognition feature
- xbmc/xbmc#27900, #27870, #22546 — `[depends]` PR examples confirming detection patterns and blast radius
- Direct codebase analysis: `src/knowledge/retrieval.ts`, `src/knowledge/retrieval-rerank.ts`, `src/knowledge/cross-corpus-rrf.ts`, `src/lib/dep-bump-detector.ts`, `src/lib/dep-bump-enrichment.ts`, `src/execution/mcp/ci-status-server.ts`, `src/db/migrations/` (all 6 existing migrations)
- pgvector documentation — filtered vector queries, HNSW index behavior under language filtering
- Voyage AI docs — voyage-code-3 specs (32K context window, 1024 dims, per-token pricing)
- GitHub REST API docs — Checks API (`checks.listForRef`, `checks.listAnnotations`) vs. Actions API vs. Commit Statuses

### Secondary (MEDIUM confidence)
- ContextCRBench (arxiv 2511.07017) — hunk-level quality assessment for code review; validates granularity approach for Phase 4
- Greptile blog — per-function chunking vs. per-file for code search retrieval quality; supports Phase 4 rationale
- "Understanding and Detecting Flaky Builds in GitHub Actions" (arxiv 2602.02307) — flaky test detection patterns relevant to CI failure recognition
- Reciprocal Rank Fusion literature — score distribution properties under unbalanced corpus sizes; informs Pitfall 7 prevention
- Clarvo guide on filtered vector queries — pgvector HNSW behavior with `WHERE` clauses and `ef_search` tuning

### Tertiary (LOW confidence)
- Upstream repo resolution for arbitrary C/C++ library names (e.g., "zlib" -> madler/zlib) — no authoritative registry; resolution logic requires heuristics or manual mapping table; needs validation during Phase 2 spike

---
*Research completed: 2026-02-25*
*Ready for roadmap: yes*

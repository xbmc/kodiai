# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, and reviewer context. Everything else extends this.

## Current State

M041 is complete and M038/S01 is now complete. Kodiai now has the first consumer-side structural-impact layer for M038: explicit graph/corpus adapter seams, a bounded `StructuralImpactPayload` contract, concurrent graph+canonical retrieval orchestration with timeout/degradation handling, stable review-scoped cache keys, structured signal emission, and a review-facing integration seam that `src/handlers/review.ts` now uses for graph-aware file selection without direct substrate calls. The remaining M038 work is to render this bounded payload into Review Details and prompt context (S02), then prove cache reuse and fail-open behavior end to end (S03).

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks + Slack events
- **Execution:** Azure Container App Jobs dispatch per review; agent writes `result.json` to shared Azure Files mount
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` v0.2.87; agent entrypoint at `src/execution/agent-entrypoint.ts`
- **MCP:** Per-job bearer tokens, stateless HTTP MCP servers; registry in `src/execution/mcp/http-server.ts`
- **Review output:** GitHub comment with `formatReviewDetailsSummary()` in `src/lib/review-utils.ts` posting Review Details `<details>` block (includes usage/token lines when present)
- **Cost tracking:** `src/llm/cost-tracker.ts` + `src/telemetry/` for DB persistence
- **Usage visibility:** `ExecutionResult.usageLimit` captures last `SDKRateLimitEvent` from the agent run; rendered in Review Details via optional `usageLimit` and `tokenUsage` params on `formatReviewDetailsSummary`
- **Embeddings:** Non-wiki corpora use voyage-4 (`DEFAULT_EMBEDDING_MODEL` in runtime.ts, `NON_WIKI_TARGET_EMBEDDING_MODEL` in embedding-repair.ts). Wiki pages use voyage-context-3. `createRerankProvider` in embeddings.ts provides a rerank-2.5 client with fail-open semantics for post-RRF neural reranking.
- **Canonical current-code corpus (M041 complete — all three slices):**
  - `src/db/migrations/033-canonical-code-corpus.sql` — dedicated `canonical_code_chunks` and `canonical_corpus_backfill_state` tables with indexes and SQL CHECK constraints for chunk/backfill invariants
  - `src/knowledge/canonical-code-types.ts` — canonical chunk identity, provenance, search result, and backfill-state contracts kept separate from historical diff-hunk types
  - `src/knowledge/canonical-code-store.ts` — separate Postgres/pgvector store with inserted/replaced/dedup upsert outcomes, file soft-delete replacement semantics, semantic/full-text search, stale repair helpers, backfill-state persistence, and `listChunksForFile()` for per-file identity lookup during selective refresh
  - `src/knowledge/canonical-code-chunker.ts` — dedicated current-code chunker with auditable exclusion reasons, Python/class/function/module boundaries, brace-language symbol chunking, and block fallback only for symbol-free files
  - `src/knowledge/canonical-code-ingest.ts` — dedicated snapshot ingest orchestrator that chunks files, skips excluded paths, soft-deletes prior live rows per file, embeds chunks, and upserts through the canonical store without touching historical `code_snippets` tables; per-chunk embedding failures fail open
  - `src/knowledge/canonical-code-backfill.ts` — one-time/resumable default-branch backfill pipeline that resolves the repo's actual default branch, clones via the existing workspace path, persists progress in `canonical_corpus_backfill_state`, and records bounded warnings/counters instead of aborting on single-file or single-chunk failures
  - `src/knowledge/canonical-code-update.ts` — steady-state selective refresh: loads live chunk identities per touched file, compares new chunk content hashes against existing rows, skips unchanged chunks (no DB write), re-embeds only changed/new chunks, and soft-deletes-and-restores on identity shrink; fail-open on embedding errors; reports per-file and aggregate counters (removed/updated/unchanged/failed)
  - `src/knowledge/canonical-code-retrieval.ts` — provenance-rich canonical current-code semantic search returning canonical ref, commit SHA, file path, line span, chunk type, symbol name, content hash, and embedding model
  - `src/knowledge/retrieval.ts` — unified retriever now accepts `canonicalRef` and surfaces canonical current-code as distinct `canonical_code` chunks alongside historical snippets, wiki, issue, review-comment, and learning-memory corpora
  - `src/knowledge/embedding-audit.ts` — extended with `canonical_code` in `AUDITED_CORPORA`/`EXPECTED_CORPUS_MODELS` (voyage-4); `auditCanonicalCode()` queries `canonical_code_chunks` globally for total/missing/stale/model-mismatch counts
  - `src/knowledge/embedding-repair.ts` — extended with `canonical_code` corpus support; `createCanonicalCodeRepairStore()` bridges bigint PKs into the generic number-keyed repair interface; `runCanonicalCodeEmbeddingRepair()` bounded per-pass repair (CANONICAL_CODE_REPAIR_LIMIT=2000); no persistent checkpoint
  - `scripts/verify-m041-s02.ts` — deterministic proof harness covering backfill persistence, canonical current-code retrieval evidence, corpus separation, and non-`main` default-branch propagation end to end
  - `scripts/verify-m041-s03.ts` — four-check in-memory proof harness: UNCHANGED-FILE-PRESERVATION, DRIFT-DETECTED-BY-AUDIT, SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS, REPAIR-SKIPS-WHEN-NO-DRIFT; all pass with `overallPassed:true`
  - `src/knowledge/index.ts` — exports canonical chunker, ingest, retrieval, backfill, and update surfaces for downstream slices
- **Structural-impact consumer layer (M038/S01 complete):**
  - `src/structural-impact/types.ts` — bounded consumer-facing structural-impact contract: `StructuralImpactPayload`, `StructuralImpactStatus`, graph stats, callers, likely tests, impacted files, canonical unchanged-code evidence, and degradation records
  - `src/structural-impact/adapters.ts` — local `GraphAdapter` and `CorpusAdapter` seams plus `boundStructuralImpactPayload()` assembly; M038 consumers stay decoupled from direct M040/M041 type imports
  - `src/structural-impact/orchestrator.ts` — `fetchStructuralImpact()` concurrent graph+corpus execution with per-adapter timeout handling, fail-open degradations, stable `(repo, baseSha, headSha)` cache keys, and 12-signal observability surface
  - `src/structural-impact/review-integration.ts` — review-facing wiring seam that builds concrete graph/corpus adapters, delegates to the orchestrator, and returns both the bounded payload and captured raw graph blast radius for incremental handler migration
  - `src/handlers/review.ts` — large-PR graph-aware selection path now calls `fetchReviewStructuralImpact()` instead of calling the graph substrate directly
- **Generated rules lifecycle (M036):**
  - `src/knowledge/generated-rule-store.ts` — persistence (pending/active/retired states, non-downgrading upsert, activate, retire, list, getLifecycleCounts)
  - `src/knowledge/generated-rule-proposals.ts` — deterministic proposal generation: cosine-similarity clustering, multi-gate filtering, `positive_ratio × support` signal score
  - `src/knowledge/generated-rule-sweep.ts` — fail-open background sweep entrypoint with dry-run support and three-boundary isolation
  - `src/knowledge/generated-rule-activation.ts` — activation policy (`shouldAutoActivate` predicate + `applyActivationPolicy` orchestrator); threshold default 0.7, env-var configurable
  - `src/knowledge/generated-rule-retirement.ts` — retirement policy (`shouldRetireRule` predicate + `applyRetirementPolicy` orchestrator; two criteria: below-floor + member-decay)
  - `src/knowledge/generated-rule-notify.ts` — operator notification (`notifyLifecycleRun`, `notifyActivation`, `notifyRetirement`; fail-open LifecycleNotifyHook extension point)
  - `src/knowledge/active-rules.ts` — sanitized retrieval + `formatActiveRulesSection` formatter; absolute cap of 20 rules; fail-open on store errors
  - Rules injected into `buildReviewPrompt` before custom instructions via `activeRules?: SanitizedActiveRule[]` context field
- **Cluster model substrate and scoring (M037 complete):**
  - `src/db/migrations/036-suggestion-cluster-models.sql` — ephemeral per-repo cluster model table; centroids stored as JSONB `number[][]`
  - `src/knowledge/suggestion-cluster-store.ts` — standalone store with TTL-filtered `getModel`, unfiltered `getModelIncludingStale`, `saveModel`, `deleteModel`, and `listExpiredModelRepos`
  - `src/knowledge/suggestion-cluster-builder.ts` — `buildClusterModel()` queries `learning_memories` directly, clusters positive/negative outcomes independently, computes mean centroids, enforces minimum cluster size, and fails open
  - `src/knowledge/suggestion-cluster-refresh.ts` — `createClusterRefresh()` performs bounded sequential refresh sweeps with aggregate built/skipped/failed totals and injectable `_buildFn` for tests
  - `src/knowledge/suggestion-cluster-scoring.ts` — scoring core exposing `isModelEligibleForScoring()`, `scoreFindingEmbedding()`, and `scoreFindings<T>()`; conservative thresholds; fail-open on missing models, ineligible models, and embedding/scoring errors
  - `src/knowledge/suggestion-cluster-staleness.ts` — centralized model freshness policy with four explicit states (`fresh`, `stale`, `very-stale`, `missing`) and a 24h TTL plus 4h grace window
  - `src/knowledge/suggestion-cluster-degradation.ts` — `applyClusterScoringWithDegradation()` wraps the live review path with exhaustive degradation reasons (`no-store`, `no-embedding`, `model-load-error`, `no-model`, `model-not-eligible`, `scoring-error`) and never blocks completion
  - `src/feedback/confidence-adjuster.ts` — `applyClusterScoreAdjustment()` merges cluster-derived suppress/boost signals after feedback adjustment and applies the symmetric safety guard for CRITICAL and protected MAJOR findings
  - `src/handlers/review.ts` — review pipeline integration: already-suppressed findings skip cluster scoring; cluster scoring runs after feedback adjustment; stale/missing/unavailable models fall back to the naive path
  - `scripts/verify-m037-s01.ts`, `scripts/verify-m037-s02.ts`, `scripts/verify-m037-s03.ts` — machine-verifiable proof harnesses for substrate, scoring integration, stale-policy behavior, refresh closure, cached reuse, and fail-open behavior
- **Review graph substrate, blast-radius queries, and bounded prompt integration (M040 complete):**
  - `src/db/migrations/034-review-graph.sql` — persistent review graph tables for builds, files, nodes, and edges with constraints and indexes tuned for file-scoped replacement
  - `src/review-graph/types.ts` — typed node/edge/file/build contracts plus `ReviewGraphStore` interface with `listWorkspaceGraph()` snapshot API
  - `src/review-graph/store.ts` — Postgres-backed review graph store with `upsertBuild()`, `replaceFileGraph()`, `listWorkspaceGraph()`, and file/build lookup helpers
  - `src/review-graph/extractors.ts` — file-scoped Python and C++ extraction for files, symbols, imports/includes, callsites, and probable test nodes/edges with explicit confidence
  - `src/review-graph/indexer.ts` — incremental workspace indexer using SHA-256 content hashes, supported-language filtering, structured counters, and build-state upserts
  - `src/review-graph/query.ts` — `queryBlastRadiusFromSnapshot()` pure function + `createReviewGraphQuery()` store-backed wrapper; outputs ranked impacted files, probable dependents, likely tests, and seed symbols; edge weight + confidence scoring with bounded heuristic fallback for incomplete cross-file edges
  - `src/lib/file-risk-scorer.ts` — `applyGraphAwareSelection()` merges graph blast-radius signals into existing file-risk scores; preserves risk ordering when graph is absent (fail-open)
  - `src/review-graph/prompt-context.ts` — `buildGraphContextSection()` converts blast-radius result to bounded Markdown prompt section; hard item caps (20/10/10) + char budget (default 2500); returns stats for observability; fail-open on null input
  - `src/review-graph/validation.ts` — `isTrivialChange()` fail-closed trivial-bypass predicate; `validateGraphAmplifiedFindings()` optional non-destructive second-pass LLM annotation gate (fail-open, defaults off)
  - `src/handlers/review.ts` — full wiring: trivial bypass before graph query; blast radius passed to `buildReviewPrompt()`; optional validation gate after guardrail pipeline; all three paths fail-open
  - `src/execution/review-prompt.ts` — `buildReviewPrompt()` accepts `graphBlastRadius` + `graphContextOptions` params; graph section injected between incremental-review context and knowledge-retrieval context
  - `scripts/verify-m040-s02.ts`, `scripts/verify-m040-s03.ts` — machine-verifiable proof harnesses for blast-radius ranking, bounded prompt/bypass/validation

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001–M033: MVP through Security Hardening (all complete)
- [x] M034: Claude Code Usage Visibility — Surface weekly limit utilization and token usage in Review Details
- [ ] M035: Voyage AI Model Upgrades — voyage-4 + rerank-2.5
  - [x] S01: voyage-4 Embedding Upgrade + Reranker Client
  - [ ] S02: Reranker Pipeline Wiring + Runtime Integration
- [ ] M039: Review Output Hardening — tighten breaking-change keyword parsing, restore truthful Claude usage visibility, and add real regression fixtures
- [x] M036: Auto Rule Generation from Feedback — cluster learning memories → propose/auto-activate rules → inject into review prompt
  - [x] S01: Generated Rule Schema, Store, and Proposal Candidates
  - [x] S02: Rule Activation and Prompt Injection
  - [x] S03: Retirement, Notification, and Lifecycle Proof
- [x] M037: Embedding-Based Suggestion Clustering & Reinforcement Learning
  - [x] S01: Cluster Model Build and Cache — substrate complete (migration, store, builder, refresh, proof harness)
  - [x] S02: Thematic Finding Scoring and Review Integration — scoring layer wired; safety guards; proof harness
  - [x] S03: Refresh, Staleness Handling, and Fail-Open Verification — stale grace policy, refresh closure, and fail-open verification complete
- [x] M040: Graph-Backed Extensive Review Context — persistent structural graph, blast-radius review selection, bounded graph context, optional validation gate
  - [x] S01: Graph Schema and C++/Python Structural Extraction
  - [x] S02: Blast-Radius Queries and Graph-Aware Review Selection
  - [x] S03: Bounded Prompt Integration, Bypass, and Validation Gate
- [x] M041: Canonical Repo-Code Corpus — default-branch current-code chunk store with commit/ref provenance, incremental updates, and audit/repair
  - [x] S01: Canonical Schema, Chunking, and Storage
  - [x] S02: Default-Branch Backfill and Semantic Retrieval
  - [x] S03: Incremental Refresh and Audit/Repair
- [ ] M038: AST Call-Graph Impact Analysis — consume M040 graph + M041 canonical current-code substrates for bounded Structural Impact output, unchanged-code evidence, and evidence-backed breaking-change detection
  - [x] S01: Graph/Corpus Consumer Adapters and Orchestration
  - [ ] S02: Structural Impact Rendering and Review Flow Integration
  - [ ] S03: Timeout, Cache Reuse, and Fail-Open Verification

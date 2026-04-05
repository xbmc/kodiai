# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, and reviewer context. Everything else extends this.

## Current State

M040/S02 complete. The blast-radius query layer is now built on top of the S01 graph substrate. `queryBlastRadiusFromSnapshot` in `src/review-graph/query.ts` walks persisted workspace graph edges to produce ranked impacted files, probable dependents, and likely tests for any set of changed paths. `applyGraphAwareSelection` in `src/lib/file-risk-scorer.ts` merges graph blast-radius signals with existing file-risk scores to rerank large-PR file selection. The review handler now has an optional `reviewGraphQuery` DI seam that feeds into this reranker and logs structured graph influence fields (`graphHitCount`, `graphRankedSelections`, `graphAwareSelectionApplied`). Four machine-verifiable proof harness checks in `scripts/verify-m040-s02.ts` confirm: impacted files are promoted above risk-only triage, likely tests are surfaced, probable dependents are reranked, and the null-graph fallback preserves risk ordering unchanged.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks + Slack events
- **Execution:** Azure Container App Jobs dispatch per review; agent writes `result.json` to shared Azure Files mount
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` v0.2.87; agent entrypoint at `src/execution/agent-entrypoint.ts`
- **MCP:** Per-job bearer tokens, stateless HTTP MCP servers; registry in `src/execution/mcp/http-server.ts`
- **Review output:** GitHub comment with `formatReviewDetailsSummary()` in `src/lib/review-utils.ts` posting Review Details `<details>` block (includes usage/token lines when present)
- **Cost tracking:** `src/llm/cost-tracker.ts` + `src/telemetry/` for DB persistence
- **Usage visibility:** `ExecutionResult.usageLimit` captures last `SDKRateLimitEvent` from the agent run; rendered in Review Details via optional `usageLimit` and `tokenUsage` params on `formatReviewDetailsSummary`
- **Embeddings:** Non-wiki corpora use voyage-4 (`DEFAULT_EMBEDDING_MODEL` in runtime.ts, `NON_WIKI_TARGET_EMBEDDING_MODEL` in embedding-repair.ts). Wiki pages use voyage-context-3. `createRerankProvider` in embeddings.ts provides a rerank-2.5 client with fail-open semantics for post-RRF neural reranking.
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
- **Review graph substrate and blast-radius queries (M040/S01+S02 complete):**
  - `src/db/migrations/034-review-graph.sql` — persistent review graph tables for builds, files, nodes, and edges with constraints and indexes tuned for file-scoped replacement
  - `src/review-graph/types.ts` — typed node/edge/file/build contracts plus `ReviewGraphStore` interface with `listWorkspaceGraph()` snapshot API
  - `src/review-graph/store.ts` — Postgres-backed review graph store with `upsertBuild()`, `replaceFileGraph()`, `listWorkspaceGraph()`, and file/build lookup helpers
  - `src/review-graph/extractors.ts` — file-scoped Python and C++ extraction for files, symbols, imports/includes, callsites, and probable test nodes/edges with explicit confidence
  - `src/review-graph/indexer.ts` — incremental workspace indexer using SHA-256 content hashes, supported-language filtering, structured counters, and build-state upserts
  - `src/review-graph/query.ts` — `queryBlastRadiusFromSnapshot()` pure function + `createReviewGraphQuery()` store-backed wrapper; outputs ranked impacted files, probable dependents, likely tests, and seed symbols from persisted graph data; edge weight + confidence scoring with bounded heuristic fallback for incomplete cross-file edges
  - `src/lib/file-risk-scorer.ts` — `applyGraphAwareSelection()` merges graph blast-radius signals into existing file-risk scores; preserves risk ordering when graph is absent (fail-open)
  - `src/handlers/review.ts` — optional `reviewGraphQuery` DI seam fires before large-PR triage; logs `graphHitCount`/`graphRankedSelections`/`graphAwareSelectionApplied`
  - `scripts/verify-m040-s02.ts` + `scripts/verify-m040-s02.test.ts` — four machine-checkable proof checks: GRAPH-SURFACES-MISSED-FILES, GRAPH-SURFACES-LIKELY-TESTS, GRAPH-RERANKS-DEPENDENTS, FALLBACK-PRESERVES-ORDER
  - `src/review-graph/*.test.ts` — fixture-driven extractor/indexer/query coverage; DB-gated store integration tests follow `TEST_DATABASE_URL` skip semantics

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
- [ ] M040: Graph-Backed Extensive Review Context — persistent structural graph, blast-radius review selection, bounded graph context, optional validation gate
  - [x] S01: Graph Schema and C++/Python Structural Extraction
  - [x] S02: Blast-Radius Queries and Graph-Aware Review Selection
  - [ ] S03: Bounded Prompt Integration, Bypass, and Validation Gate
- [ ] M041: Canonical Repo-Code Corpus — default-branch current-code chunk store with commit/ref provenance, incremental updates, and audit/repair
- [ ] M038: AST Call-Graph Impact Analysis — consume M040 graph + M041 canonical current-code substrates for bounded Structural Impact output, unchanged-code evidence, and evidence-backed breaking-change detection

# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, and reviewer context. Everything else extends this.

## Current State

M037/S01 complete. The cluster-model substrate is built: `suggestion_cluster_models` migration (036), `SuggestionClusterStore` (getModel/getModelIncludingStale/saveModel/deleteModel/listExpiredModelRepos), `buildClusterModel` (HDBSCAN-based positive/negative centroid generation from learning memories with fail-open semantics), and `createClusterRefresh` (bounded background sweep entrypoint with injectable `_buildFn` for testing). Three-check proof harness (`verify:m037:s01`) passes. 95 tests across 4 files, tsc clean.

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
- **Cluster model substrate (M037/S01):**
  - `src/db/migrations/036-suggestion-cluster-models.sql` — ephemeral per-repo cluster model table; centroids as JSONB number[][]
  - `src/knowledge/suggestion-cluster-store.ts` — standalone store (isolated from KnowledgeStore); TTL-filtered `getModel`; `getModelIncludingStale` for refresh job; `listExpiredModelRepos` for sweep targeting
  - `src/knowledge/suggestion-cluster-builder.ts` — `buildClusterModel`: queries learning_memories directly, splits by outcome class (positive=accepted/thumbs_up, negative=suppressed/thumbs_down), runs HDBSCAN per class, computes mean centroids, enforces MIN_CLUSTER_MEMBERS=3; fail-open (never throws)
  - `src/knowledge/suggestion-cluster-refresh.ts` — `createClusterRefresh`: bounded background sweep over expired or explicit repos; sequential; injectable `_buildFn` for tests
  - `scripts/verify-m037-s01.ts` — three-check proof harness (BUILD-AND-CACHE, REFRESH-SWEEP, FAIL-OPEN)

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
- [ ] M037: Embedding-Based Suggestion Clustering & Reinforcement Learning
  - [x] S01: Cluster Model Build and Cache — substrate complete (migration, store, builder, refresh, proof harness)
  - [ ] S02: Thematic Finding Scoring and Review Integration
  - [ ] S03: Refresh, Staleness Handling, and Fail-Open Verification
- [ ] M040: Graph-Backed Extensive Review Context — persistent structural graph, blast-radius review selection, bounded graph context, optional validation gate
- [ ] M041: Canonical Repo-Code Corpus — default-branch current-code chunk store with commit/ref provenance, incremental updates, and audit/repair
- [ ] M038: AST Call-Graph Impact Analysis — consume M040 graph + M041 canonical current-code substrates for bounded Structural Impact output, unchanged-code evidence, and evidence-backed breaking-change detection

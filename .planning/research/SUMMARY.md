# Project Research Summary

**Project:** Kodiai v0.20 Multi-Model & Active Intelligence
**Domain:** AI-powered code review assistant — multi-LLM routing, wiki staleness detection, review pattern clustering, contributor profiles
**Researched:** 2026-02-25
**Confidence:** HIGH (routing, profiles, architecture); MEDIUM (clustering, staleness)

## Executive Summary

Kodiai v0.20 adds four interconnected intelligence capabilities to a production GitHub App. The research consensus is clear: build these as additive modules that complement — not replace — the existing Claude Agent SDK execution loop. The Vercel AI SDK (v6.x) provides a unified `generateText()` interface for routing non-agentic tasks (labeling, staleness analysis, summarization) to cost-appropriate models (Haiku, GPT-4o-mini, Gemini Flash), while the Agent SDK retains exclusive ownership of PR review and mention handling that require MCP tools and ephemeral workspaces. This two-path execution model is the architectural linchpin; conflating the two SDKs is the single most destructive mistake possible and would require significant architectural rework to recover from.

The second tier of complexity is review pattern clustering via HDBSCAN. A critical, well-documented pitfall exists: HDBSCAN degrades severely on raw 1024-dimensional Voyage embeddings due to the curse of dimensionality. The research is unambiguous — UMAP dimensionality reduction to 15–25 dimensions must precede HDBSCAN, and because mature UMAP implementations live in Python (umap-learn), this subsystem should be implemented as a Python sidecar batch job rather than a TypeScript-native attempt. This is the highest technical risk in the milestone and requires careful scheduling, UMAP model persistence, and cluster stability validation before any pattern is surfaced in reviews.

Wiki staleness detection and contributor profiles are comparatively lower-risk, building entirely on existing infrastructure (wiki_pages table, author-classifier.ts, Slack session store) with three new database tables and the Vercel AI SDK already added for routing. The critical operational risk for staleness is false-positive flood — a two-tier approach (fast heuristic pass first, LLM evaluation only on flagged pages capped at 20/cycle) prevents reports from becoming noise that users ignore within a week. For contributor profiles, the research is explicit: identity linking must be explicit-and-verified only, never fuzzy-matched, with unlink commands on both platforms.

## Key Findings

### Recommended Stack

The existing stack (Bun, Hono, postgres.js, pgvector, VoyageAI, Claude Agent SDK) remains entirely unchanged. Five new packages are required: `ai` (Vercel AI SDK core v6.x), `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, and `hdbscan-ts`. Three new provider API keys are needed (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) — these are distinct from the existing Claude Max OAuth used by the Agent SDK. Docker image impact is minimal (~2–5 MB, all pure JS/TS).

One critical Bun constraint: `streamText()` has a reproducible production build failure (oven-sh/bun#25630). Use `generateText()` exclusively — all targeted non-agentic tasks (labels, staleness verdicts, summaries) return complete, non-streaming output anyway. Four new database migrations are required (010–013): contributor profiles, review pattern clusters, wiki staleness signals, and model cost events.

**Core technologies:**
- `ai` ^6.0.x + `@ai-sdk/*` ^3.0.x: Unified `generateText()` API across Anthropic/OpenAI/Google — eliminates per-provider HTTP clients, provides built-in token tracking via `result.usage`
- `hdbscan-ts` ^1.0.x: TypeScript HDBSCAN for development/validation — production clustering requires Python sidecar with UMAP pre-processing
- Python sidecar (`umap-learn` + `hdbscan`): UMAP dimensionality reduction from 1024 to 15–25 dims before HDBSCAN — required to avoid total clustering failure on high-dimensional Voyage embeddings
- PostgreSQL migrations 010–013: `contributor_profiles`, `review_pattern_clusters`, `wiki_staleness_signals`, `model_cost_events`

### Expected Features

See `FEATURES.md` for full specifications, complexity estimates, and the complete feature dependency graph.

**Must have (table stakes):**
- Task-based model routing with `.kodiai.yml` `models:` config — users expect per-repo control over which model handles which task
- Cost tracking per invocation (`model_id`, `provider`, `task_type`, `estimated_cost_usd`) — multi-model without cost visibility is irresponsible
- Wiki staleness scoring with evidence — a staleness flag without specific evidence (which code change, which wiki quote) is ignored
- Staleness report delivery to Slack/#kodiai or GitHub issue with dismiss workflow — detection without reporting is useless
- HDBSCAN cluster label generation — unlabeled clusters are noise, not insight; human-readable labels required
- GitHub/Slack identity linking via explicit commands (`@kodiai link @github-user`) — cross-platform profiles require verified links only
- Contributor expertise inference from PR history — a profile without expertise data is just a user record

**Should have (differentiators):**
- Emergent review theme discovery — "your last 50 PRs keep hitting the same 3 issues" from 18 months of existing embeddings with no additional data collection
- Recurring pattern injection into PR review prompts — top-matching cluster themes as "Recurring themes in this codebase" context (max 1 callout per review)
- Adaptive review depth per contributor — first-time contributors get more explanation; core maintainers get terse, high-signal reviews
- Multi-model cost optimization with visible savings — route simple tasks to cheap models, track cost delta vs single-model baseline in telemetry
- Wiki-to-code evidence linking at file-path level — show which commits and files made a page stale

**Defer (v2+):**
- Cross-platform activity timeline (requires a dashboard UI surface that does not exist)
- Symbol-level wiki staleness — function/class name extraction from wiki prose needs iteration; start with file-path references
- Real-time clustering on every PR — batch is sufficient; per-PR HDBSCAN is performance-prohibitive
- Full contributor dashboard — no UI surface; Slack queries and GitHub issue reports are sufficient
- Bedrock/Vertex provider auth — OAuth-only constraint per PROJECT.md; API key-based providers only

### Architecture Approach

Four new modules integrate as additive factory functions following the established `createXxx(deps)` pattern throughout the codebase. The existing event router, executor, and review handler are modified but not replaced. Non-critical work (staleness detection post-merge, cost logging, pattern updates) follows the established fire-and-forget pattern (`void promise.catch()`) already used for hunk embedding and telemetry recording. Scheduled jobs use the `setInterval` + shutdown manager pattern from wiki-sync.ts — no external cron dependency needed.

**Major components:**
1. `src/llm/` — Model Router: `createProviderRegistry()` with Anthropic/OpenAI/Google providers, task-type-to-model mapping, cost tracking to `model_cost_events` table. Foundation for all other non-agentic LLM calls.
2. `src/identity/` — Contributor Profiles: Explicit GitHub↔Slack identity linking (verified only), expertise inference from PR file history and review comment patterns, profile cache with 15-min TTL. Enriches review and mention handler prompt building.
3. `src/intelligence/wiki-staleness.ts` — Staleness Detection: Two-tier (heuristic + LLM capped at 20 pages/cycle), cross-references `wiki_pages` against git history, delivers top-5 evidence reports. Triggered post-wiki-sync and fire-and-forget on PR merge.
4. `src/intelligence/pattern-cluster.ts` — Review Pattern Clustering: Python sidecar (UMAP + HDBSCAN) on 18 months of existing Voyage embeddings, cluster label generation via model router (Haiku), HNSW-indexed centroid table (`review_pattern_clusters`) for fast per-review similarity lookup, weekly batch schedule.

### Critical Pitfalls

Full analysis of 10 pitfalls (6 critical, 4 moderate) in `PITFALLS.md`.

1. **Vercel AI SDK replacing Agent SDK** — draw a hard `TaskType` boundary before writing any code. Agent SDK owns `pr_review` and `mention_response` (MCP tools, ephemeral workspace); Vercel AI SDK owns all new task types only. Never pass AI SDK model instances into `createExecutor()`. Recovery is HIGH cost.

2. **HDBSCAN on raw 1024-dim embeddings** — without UMAP reduction, HDBSCAN produces either all-noise or one giant cluster. Apply UMAP (15–25 dims, `metric='cosine'`, `min_dist=0.0`) before clustering. Persist the fitted UMAP transform for incremental projection of new points via `transform()`. Recovery is MEDIUM cost (drop/recreate cluster tables).

3. **Staleness false-positive flood** — without two-tier detection, LLM evaluation runs on all 2000+ wiki pages per sync cycle ($5–10/cycle) producing 30+ flagged pages that users ignore after week one. Enforce: heuristic pass first, LLM capped at 20 pages/cycle, dismiss workflow, top-5-only reports with specific code diff + wiki quote evidence.

4. **Ambiguous contributor identity linking** — fuzzy name/email matching creates silent mismatches that corrupt adaptive behavior with no user-visible way to detect or fix them. Use explicit Slack commands only. Include `verified BOOLEAN` and `link_method` columns. Provide unlink commands on both surfaces. Recovery is MEDIUM cost.

5. **Bun `streamText()` production failure** — oven-sh/bun#25630 causes network errors in production builds. Use `generateText()` exclusively. Add a startup smoke test that validates `generateText()` in the deployed Azure environment. Recovery is LOW cost but causes production outage if not caught first.

6. **Incomparable token counts across models** — 1000 tokens on Claude Sonnet ≠ 1000 tokens on GPT-4o. Never sum raw tokens across different models. `model_cost_events` table must have `model_id`, `provider`, `task_type`, and `estimated_cost_usd` computed at write time. Aggregate by USD only. Recovery is LOW cost.

## Implications for Roadmap

Four phases with clear dependency ordering. Phases 1 and 2 can run in parallel; Phases 3 and 4 both require Phase 1 to complete first.

### Phase 1: Multi-LLM Routing + Cost Tracking
**Rationale:** Foundation for all other phases — pattern labeling, staleness analysis, and expertise inference all call `modelRouter.generate()`. Self-contained with no changes to the existing review flow. Must establish the Agent SDK / Vercel AI SDK boundary as its primary architectural constraint before any other code is written.
**Delivers:** `src/llm/` module (registry, router, cost-tracker), `model_cost_events` table (migration 013), provider registry for Anthropic/OpenAI/Google, `.kodiai.yml` `models:` config section, cost tracking with `model_id` + `task_type` + `estimated_cost_usd`, startup smoke test for `generateText()` in production build.
**Addresses:** Task-based model routing, provider config in .kodiai.yml, cost tracking per invocation.
**Avoids:** Pitfall 1 (SDK conflation — hard boundary established here), Pitfall 2 (Bun streaming — `generateText()` only constraint documented here), Pitfall 6 (incomparable token costs — `model_cost_events` schema with `estimated_cost_usd` ships with routing), Pitfall 9 (silent model fallback — fallback logging defined in routing config).
**Research flag:** SKIP — Vercel AI SDK is thoroughly documented at HIGH confidence; Bun compatibility confirmed; streaming pitfall is documented with issue number and avoidable with a single design constraint.

### Phase 2: Contributor Profiles + Identity Linking
**Rationale:** Independent of Phase 1 (no model router dependency). Can be built in parallel with Phase 1. Prerequisite for adaptive review behavior in later phases. Light handler integration with low regression risk on the existing review flow.
**Delivers:** `src/identity/` module (store, linker, expertise), `contributor_profiles` table (migration 010), explicit GitHub↔Slack link flow via Slack `!kodiai link @github-user` command, expertise inference from PR file history and review comment patterns (batch daily), review handler and mention handler integration for tone adaptation.
**Addresses:** GitHub/Slack identity linking, contributor expertise inference, adaptive review depth.
**Avoids:** Pitfall 5 (identity ambiguity — verified-only linking, `verified` column, unlink commands on both surfaces, no fuzzy matching).
**Research flag:** SKIP — standard CRUD plus well-understood identity pattern. Explicit-only linking removes the hard identity resolution problem entirely. `createContributorStore(deps)` follows established factory pattern exactly.

### Phase 3: Wiki Staleness Detection
**Rationale:** Requires Phase 1 (model router provides LLM staleness analysis calls). Builds on existing wiki_pages table, wiki-sync.ts scheduler, Octokit, and Slack client — no new external integrations. Medium complexity with manageable risk if two-tier detection is designed from the start.
**Delivers:** `src/intelligence/wiki-staleness.ts` + `wiki-staleness-types.ts` + `wiki-staleness-report.ts`, `wiki_staleness_signals` table (migration 012), two-tier detection (heuristic pass + LLM capped at 20 pages/cycle), dismiss workflow, evidence-backed top-5 reports to Slack/#kodiai or GitHub issue, fire-and-forget trigger on PR merge, exclusion of pages updated within last 7 days.
**Addresses:** Wiki staleness scoring, staleness report delivery, wiki-to-code evidence linking (file-path level).
**Avoids:** Pitfall 4 (false-positive flood — two-tier filtering and 20-page cap enforced from design). Pitfall 10 (wiki prompt injection — wiki content wrapped in `<wiki_content>` delimited untrusted block, length-capped at 2000 chars, treated as user input not system prompt).
**Research flag:** NEEDS RESEARCH at planning time. The heuristic pass design — mapping wiki prose to code file paths — needs validation against actual Kodi wiki content before implementation begins. Risk: a naive approach requires architectural revision after seeing real content. A brief spike on 20–30 representative Kodi wiki pages will define the heuristic correctly.

### Phase 4: Review Pattern Clustering
**Rationale:** Requires Phase 1 (model router for cluster label generation). Most complex feature due to HDBSCAN high-dimensionality pitfall, Python sidecar deployment, cluster stability requirements, and prompt injection. Placed last to allow Phases 1–3 to stabilize and to give the Python sidecar deployment strategy time to be resolved.
**Delivers:** Python sidecar (`umap-learn` + `hdbscan`) for batch clustering of existing Voyage embeddings, UMAP model persistence (`joblib` serialization) for incremental projection, `review_pattern_clusters` table (migration 011) with HNSW-indexed centroid column, cluster label generation via model router (Haiku), bootstrap stability validation (>70% before surfacing), pattern injection into PR review prompt (max 1 callout per review, minimum 10 cluster members, >0.85 centroid similarity), weekly batch schedule via `setInterval` + shutdown manager.
**Addresses:** Emergent review theme discovery, recurring pattern injection into PR reviews.
**Avoids:** Pitfall 3 (raw high-dim HDBSCAN — UMAP to 15–25 dims is non-negotiable). Pitfall 7 (UMAP not persisted — serialize fitted transform after each batch; use `transform()` for new points; monthly refit scheduled). Pitfall 8 (unstable cluster labels — bootstrap stability before surfacing; centroid-based label caching with 0.1 cosine distance threshold for regeneration; min cluster size 5).
**Research flag:** NEEDS RESEARCH at planning time for Python sidecar deployment. Key questions to resolve: (a) Docker image strategy — multi-stage Bun + Python image vs. separate sidecar container, (b) Bun subprocess management for Python process, (c) embedding batch serialization format (JSON is slow; evaluate msgpack or numpy binary), (d) UMAP model serialization format (joblib vs pickle), (e) whether `umap-js` npm package is production-quality as a TypeScript-native alternative (would eliminate the sidecar entirely if viable).

### Phase Ordering Rationale

- Phase 1 before Phases 3 and 4: Both wiki staleness analysis and cluster labeling call `modelRouter.generate()`; the router must exist before either can be implemented.
- Phases 1 and 2 in parallel: Contributor profiles have no dependency on the model router. They share only database infrastructure and can be built simultaneously by separate workstreams.
- Phase 3 before Phase 4: Both are independent of each other after Phase 1, but staleness detection is lower-risk and validates the fire-and-forget integration pattern before the more complex clustering work.
- Phase 4 last: Highest technical risk (UMAP sidecar, stability validation, Python deployment), most novel (no existing pattern in codebase), and deployment strategy needs resolution time.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Wiki Staleness):** Entity extraction heuristic — how to map Kodi wiki prose to code file paths — needs validation against actual wiki content before implementation begins. A brief spike on 20–30 representative pages will reveal the structure. Without this, the heuristic filter may be too broad (over-detection) or too narrow (under-detection), requiring architectural revision.
- **Phase 4 (Pattern Clustering):** Python sidecar deployment strategy needs resolution before implementation. Evaluate: `umap-js` npm package quality as a TypeScript-native UMAP alternative (would eliminate the sidecar entirely); Docker strategy for Python in a Bun container; Bun subprocess management; embedding serialization format for float arrays at scale.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Multi-LLM Routing):** Vercel AI SDK v6 is thoroughly documented with official examples. Bun compatibility confirmed. Streaming pitfall is documented with a specific GitHub issue number and avoidable with one design constraint. All integration points in the existing codebase are known.
- **Phase 2 (Contributor Profiles):** Standard CRUD pattern with well-understood factory function integration. Explicit-only identity linking eliminates the hard identity resolution problem. No novel algorithms or external services.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Vercel AI SDK v6 fully documented; npm package versions verified (ai@6.0.97 published 2026-02-21, @ai-sdk/anthropic@3.0.46 published 2026-02-23); Bun compatibility confirmed via official Bun blog; Bun streaming failure documented in oven-sh/bun#25630 |
| Features | HIGH | Clear must-have / differentiator / defer structure with LOC estimates; existing infrastructure inventory confirmed via codebase analysis; complexity estimates are feature-specific |
| Architecture | HIGH | Factory function + fire-and-forget patterns well-understood from codebase analysis; two-path execution model (Agent SDK + Vercel AI SDK) is explicit and justified; all integration points in existing handlers identified |
| Pitfalls | HIGH for routing/streaming/identity; MEDIUM for clustering/staleness | HDBSCAN dimensionality failure is documented in HDBSCAN official docs and academic literature; UMAP+HDBSCAN accuracy improvement is research-backed; staleness heuristic design for Kodi wiki content is the main open question |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **UMAP sidecar deployment:** Python process management strategy for Azure Container Apps is not fully resolved. Options: (a) multi-stage Docker build with Bun + Python in one image, (b) separate sidecar container with HTTP/gRPC API, (c) Azure Container Apps job for scheduled batch. Decision affects Phase 4 implementation significantly. Resolve at Phase 4 planning time with a spike on `umap-js` npm package quality first (may eliminate the sidecar entirely).

- **Wiki entity extraction accuracy:** The heuristic for mapping wiki pages to code file paths has not been validated against actual Kodi wiki content. Kodi wiki pages vary widely in structure. Resolve at Phase 3 planning time with a sample content analysis before writing implementation steps.

- **`hdbscan-ts` vs Python sidecar resolution:** STACK.md recommends `hdbscan-ts` (TypeScript); PITFALLS.md is explicit that raw 1024-dim embeddings will cause clustering failure and recommends Python with UMAP. The deciding question is whether `umap-js` is production-quality for this use case. If yes: TypeScript-only pipeline is viable. If no: Python sidecar is required. Evaluate at Phase 4 planning time — a brief spike loading real Voyage embeddings into `umap-js` will answer this definitively.

- **Migration numbering:** STACK.md and ARCHITECTURE.md have slightly different migration numbering (STACK.md assigns contributor profiles to 011, ARCHITECTURE.md to 010). Canonical order: 010-contributor-profiles, 011-review-patterns, 012-wiki-staleness, 013-model-cost-events. Confirm against actual current migration state before writing any migration files.

## Sources

### Primary (HIGH confidence)
- [Vercel AI SDK Documentation](https://ai-sdk.dev/docs/introduction) — generateText, provider management, token tracking, AI SDK 6 migration guide
- [AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6) — version confirmation, Bun support statement
- [ai npm v6.0.97](https://www.npmjs.com/package/ai), [@ai-sdk/anthropic v3.0.46](https://www.npmjs.com/package/@ai-sdk/anthropic) — current versions verified 2026-02-21 to 2026-02-23
- [Bun streaming issue oven-sh/bun#25630](https://github.com/oven-sh/bun/issues/25630) — reproducible production build streaming failure, documented with repro steps
- [HDBSCAN documentation](https://hdbscan.readthedocs.io/en/latest/faq.html) — dimensionality limits, parameter guidance
- [UMAP clustering guide](https://umap-learn.readthedocs.io/en/latest/clustering.html) — recommended settings for pre-clustering reduction (`min_dist=0.0`, `n_components=15-25`, `metric='cosine'`)
- Codebase analysis: `src/execution/executor.ts`, `src/knowledge/wiki-store.ts`, `src/knowledge/retrieval.ts`, `src/telemetry/types.ts`, `src/lib/author-classifier.ts`, `src/db/migrations/` — existing infrastructure inventory confirmed as primary source

### Secondary (MEDIUM confidence)
- [UMAP+HDBSCAN performance research (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7340901/) — 60% accuracy improvement and runtime reduction from 26 min to 5 sec with UMAP pre-processing
- [BERTopic clustering pipeline](https://maartengr.github.io/BERTopic/getting_started/clustering/clustering.html) — UMAP+HDBSCAN pipeline patterns for text embeddings
- [Content freshness automation (Cobbai)](https://cobbai.com/blog/knowledge-freshness-automation) — two-tier staleness detection best practices
- [GitHub/Slack identity mapping patterns (hmcts)](https://github.com/hmcts/github-slack-user-mappings) — explicit linking command pattern validation
- [Langfuse token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) — multi-model cost normalization patterns; cross-provider USD aggregation
- [hdbscan-ts npm v1.0.16](https://www.npmjs.com/package/hdbscan-ts) — package exists and has clean TypeScript API; low download count (~30/week) noted as risk

### Tertiary (LOW confidence)
- [Detecting outdated code element references in documentation (Springer)](https://link.springer.com/article/10.1007/s10664-023-10397-6) — wiki entity extraction approaches (academic; needs practical validation against Kodi wiki structure)
- [Wikipedia staleness detection research (EDBT 2023)](https://openproceedings.org/2023/conf/edbt/3-paper-33.pdf) — general staleness patterns (academic; not directly applicable to developer wiki use case)

---
*Research completed: 2026-02-25*
*Ready for roadmap: yes*

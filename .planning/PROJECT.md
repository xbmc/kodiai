# Kodiai

## What This Is

Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews and conversational code assistance via `@kodiai` mentions. It replaces the current approach of forking `anthropics/claude-code-action` and maintaining workflow YAML files in every repo — instead, repos just install the app and optionally drop a `.kodiai.yml` config file.

## Core Value

When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, or contextual answers to questions — without requiring any workflow setup in the target repo.

## Current Milestone: v0.6 Review Output Formatting & UX

**Goal:** Make review outputs maintainer-friendly, merge-confident, and low-drama by restructuring comment format, adding explicit merge recommendations, and removing noise

**Target features:**
- Structured initial reviews (What changed → Strengths → Observations → Suggestions → Verdict)
- Explicit merge recommendations (✅ Ready to merge / ⚠️ Address X before merging)
- Embedded Review Details in summaries (remove standalone comments)
- Delta-focused re-reviews (only show what's changed/relevant since last review)
- Remove time-saved estimates from Review Details
- Use ✅ for verified positives, severity tags for negatives

## Latest Release: v0.5 Advanced Learning & Language Support

**Shipped:** 2026-02-13
**Phases:** 30-33 (4 phases, 12 plans)

**Delivered:**
- SHA-keyed run state for idempotent webhook processing with force-push detection
- Embedding-backed learning memory with Voyage AI and sqlite-vec for semantic pattern retrieval
- Incremental re-review focusing on changed code with fingerprint-based finding deduplication
- Bounded retrieval context enriching prompts with top-K similar findings
- Multi-language classification and guidance for 20 languages (detailed guidance for 9 major languages)
- Explainable delta reporting with new/resolved/still-open labeling and learning provenance citations
- Configurable output language localization preserving canonical severity/category taxonomy

<details>
<summary>Previous Release: v0.4 Intelligent Review System (2026-02-12)</summary>

**Delivered:**
- Configurable review strictness (mode, severity threshold, focus areas, comment caps)
- Context-aware review prompts with deterministic diff analysis and path-scoped instructions
- Repo-scoped knowledge store with explicit suppressions and confidence filtering
- Quantitative Review Details reporting (files, lines, severity counts, time-saved estimate)
- Idempotent thumbs-reaction feedback capture linked to persisted findings

</details>

## Requirements

### Validated

- ✓ Webhook server receives GitHub events and verifies signatures — v0.1
- ✓ GitHub App authenticates via JWT and mints installation tokens — v0.1
- ✓ Event router classifies webhooks and dispatches to handlers — v0.1
- ✓ Per-repo `.kodiai.yml` config loaded with sensible defaults (zero-config works) — v0.1
- ✓ PR auto-review on open/ready + manual re-request (`review_requested`) — v0.1
- ✓ Inline review comments with suggestion blocks — v0.1
- ✓ Fork PR support works natively — v0.1
- ✓ `@kodiai` mention handling across issue/PR/review surfaces — v0.1
- ✓ Tracking comments show progress and update on completion/error — v0.1
- ✓ Content sanitization + TOCTOU protections — v0.1
- ✓ Bot ignores its own comments (no infinite loops) — v0.1
- ✓ Job queue with per-installation concurrency limits + ephemeral workspaces — v0.1
- ✓ Review UX improvements (eyes reaction, `<details>` wrapping, conditional summaries) — v0.1
- ✓ Production deployment to Azure Container Apps (Docker + probes + secrets) — v0.1
- ✓ Review-request reliability hardening (delivery correlation, runbook, output idempotency) — v0.1
- ✓ Code modification via @mention (branch creation, commit, push) with guardrails — v0.2
- ✓ Write-mode reliability (clearer failures, safer retries, plan-only mode) — v0.2
- ✓ Forward-compatible config parsing with graceful degradation — v0.3
- ✓ Enhanced config controls (review/mention/write-mode guardrails) — v0.3
- ✓ Usage telemetry collection with persistent SQLite storage — v0.3
- ✓ CLI reporting tool with filtering and multiple output formats — v0.3
- ✓ Telemetry opt-out and cost warning thresholds — v0.3
- ✓ Review mode/severity/focus controls with noise suppression and bounded comment output — v0.4
- ✓ Context-aware review pipeline with path instructions and deterministic risk analysis — v0.4
- ✓ Repo-scoped knowledge persistence with explicit suppressions and confidence threshold filtering — v0.4
- ✓ Review Details metrics contract and persistence for review quality analysis — v0.4
- ✓ Feedback capture from human thumbs reactions with deterministic finding linkage — v0.4
- ✓ Embedding-backed learning memory with repo isolation and semantic retrieval — v0.5
- ✓ SHA-keyed run state for idempotent webhook redelivery deduplication — v0.5
- ✓ Incremental re-review focusing on changed hunks with finding deduplication — v0.5
- ✓ Bounded retrieval context with configurable top-K and distance thresholds — v0.5
- ✓ Multi-language classification and language-specific guidance for 20 languages — v0.5
- ✓ Configurable output language localization preserving code snippet integrity — v0.5
- ✓ Explainable delta reporting with new/resolved/still-open labels and learning provenance — v0.5

### Active

- [ ] **FORMAT-01**: Initial PR reviews use structured format (What changed → Strengths → Observations → Suggestions → Verdict)
- [ ] **FORMAT-02**: Verdict section provides explicit merge recommendation (✅ Ready / ⚠️ Address X)
- [ ] **FORMAT-03**: Review Details embedded as collapsible section in summary (not standalone comment)
- [ ] **FORMAT-04**: Re-reviews show delta findings only (what changed since last review)
- [ ] **FORMAT-05**: Remove "Estimated review time saved" from Review Details
- [ ] **FORMAT-06**: Use ✅ checkmarks for verified positives, severity tags for negatives
- [ ] **FORMAT-07**: Separate blockers from minor issues explicitly in verdict
- [ ] **FORMAT-08**: Signal review scope with progress checklist (e.g., "Reviewed: logic ✅, tests ✅")

### Out of Scope

- Direct SDK agent loop for non-Claude LLMs — Phase 2+ after v1 is stable
- Bedrock / Vertex / API key auth backends — OAuth only for v1
- Public GitHub Marketplace listing — small group of known users for now
- Real-time streaming UI or dashboard — GitHub comments are the interface
- CI/CD pipeline automation — deployment is manual or separate

## Context

- **GitHub App:** Registered (App ID 2822869, slug `kodiai`)
- **Production:** Deployed on Azure Container Apps
  - FQDN: `ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io`
  - Webhook: `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github`
- **Test repo:** `kodiai/xbmc` (public fork) used to validate PR review + mention flows
- **Core stack:** Bun + Hono, Octokit, Agent SDK (`query()`), in-process MCP servers, in-process queue (p-queue)
- **Execution model:** clone workspace -> build prompt -> invoke Claude Code -> publish outputs via MCP tools
- **Storage:** SQLite WAL databases (`./data/kodiai-telemetry.db`, `./data/kodiai-knowledge.db`) with sqlite-vec extension for vector retrieval
- **Embedding provider:** Voyage AI (optional, VOYAGE_API_KEY required for semantic retrieval)
- **Codebase:** ~22,481 lines of TypeScript, 372 tests passing

## Current State

v0.5 ships an installable GitHub App that:
- Automatically reviews PRs with inline comments, suggestions, and optional silent approvals
- Responds to `@kodiai` mentions across GitHub comment surfaces with write-mode support
- Adapts review behavior via per-repo mode/severity/focus/profile/path-instruction controls
- Applies deterministic diff/risk context before LLM review for targeted findings
- Persists review findings and suppression context in a SQLite knowledge store
- Filters low-confidence and explicitly suppressed findings from visible inline output
- Captures thumbs-up/down feedback reactions for future learning analysis
- Records usage telemetry (tokens, cost, duration) for every execution
- **Deduplicates webhook redeliveries using SHA-keyed run state for idempotent processing**
- **Learns from past reviews using embedding-backed semantic retrieval with repo isolation**
- **Performs incremental re-reviews focusing only on changed code hunks**
- **Enriches review context with bounded top-K similar findings from learning memory**
- **Classifies and adapts to 20 programming languages with language-specific guidance**
- **Supports localized output language while preserving code snippet integrity**
- **Reports finding deltas (new/resolved/still-open) with explainable learning provenance**
- Provides per-repo configuration via `.kodiai.yml` (review control, mention allowlists, write-mode guardrails, telemetry opt-out, retrieval tuning, output language)
- Includes CLI reporting tool for operators to query usage metrics
- Is production-deployed with observability, cost warnings, and operational runbooks

## Next Milestone Goals

- Define v0.6 requirement set and roadmap from shipped v0.5 learnings
- Evaluate whether embeddings-based learning should stay optional or become default behavior
- Prioritize larger platform bets after v0.5 (marketplace readiness, broader deployment options)

## Constraints

- **Runtime:** Bun — used for both dev and production
- **Framework:** Hono for the HTTP server
- **Auth:** Claude Max OAuth token only for v1
- **Deployment:** Azure Container Apps (needs provisioning)
- **Audience:** Private use — small group of known users, not public marketplace
- **Compute:** Self-hosted (our Azure infra), not GitHub Actions runners

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Bun + Hono over Node + Express | Bun is fast, has native TypeScript support, Hono is lightweight and runs anywhere | ✓ Good |
| Claude Code CLI over direct API calls | Gets full Claude Code toolchain for free — file editing, MCP, tool use | ✓ Good |
| In-process p-queue over external queue | Simpler to start; can migrate to durable queue later if needed | ✓ Good |
| Shallow clone per job | Avoids large repo downloads; 50 commits gives enough diff context | ✓ Good |
| `.kodiai.yml` config over env vars | Per-repo customization without touching the app server | ✓ Good |
| Two-pass safeParse for config | Fast path tries full schema, fallback parses sections independently for surgical error handling | ✓ Good — v0.3 |
| SQLite WAL mode for telemetry | Allows concurrent reads (CLI) while server writes; simpler than external DB | ✓ Good — v0.3 |
| Fire-and-forget telemetry capture | Non-blocking writes prevent telemetry failures from breaking critical path | ✓ Good — v0.3 |
| Cost warnings nested in telemetry gate | Disabling telemetry suppresses both recording and warnings (user expectation) | ✓ Good — v0.3 |
| Self-contained CLI scripts in scripts/ | No src/ imports, zero coupling, prevents accidental server startup | ✓ Good — v0.3 |
| SHA-keyed run state for idempotency | Keyed by base+head SHA pair, not delivery ID; catches GitHub retries and force-push supersession | ✓ Good — v0.5 |
| Fail-open run state checks | Run state errors log warning and proceed with review; never block publication | ✓ Good — v0.5 |
| Fixed 1024-dim vec0 embeddings | Voyage AI default dimension; changing requires table recreation | — Pending — v0.5 |
| Owner-level shared pool via partition iteration | Query up to 5 repos via partition key rather than separate unpartitioned table | ✓ Good — v0.5 |
| Fire-and-forget learning memory writes | Async writes never block review completion; errors logged but non-fatal | ✓ Good — v0.5 |
| onSynchronize defaults false (opt-in) | Frequent pushes could generate expensive reviews; explicit opt-in required | ✓ Good — v0.5 |
| Conservative retrieval defaults | topK=5, distanceThreshold=0.3, maxContextChars=2000 prevents prompt bloat | ✓ Good — v0.5 |
| State-driven incremental mode | Based on prior completed review existence, not event type; works for both synchronize and review_requested | ✓ Good — v0.5 |
| Fingerprint-based finding deduplication | filePath + titleFingerprint composite key for O(1) suppression lookup | ✓ Good — v0.5 |
| Free-form outputLanguage config | z.string() not enum; LLMs understand both ISO codes and full language names | ✓ Good — v0.5 |
| Language guidance capped at top 5 | Prevents prompt bloat in multi-language PRs | ✓ Good — v0.5 |
| Distance thresholds for provenance relevance | <=0.15 high, <=0.25 moderate, else low; provides explainable confidence labels | ✓ Good — v0.5 |

---
*Last updated: 2026-02-13 after v0.5 milestone completion*

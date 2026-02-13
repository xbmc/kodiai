# Kodiai

## What This Is

Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews and conversational code assistance via `@kodiai` mentions. It replaces the current approach of forking `anthropics/claude-code-action` and maintaining workflow YAML files in every repo — instead, repos just install the app and optionally drop a `.kodiai.yml` config file.

## Core Value

When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, or contextual answers to questions — without requiring any workflow setup in the target repo.

## Current Milestone: v0.5 Advanced Learning & Language Support

**Goal:** Expand review intelligence with higher-signal learning loops and broader multi-language understanding while preserving Kodiai's low-noise default behavior.

**Target features:**
- Embedding-assisted feedback clustering for recurring false-positive detection
- Incremental re-review that focuses on newly changed diffs instead of reprocessing full PR history
- Multi-language diff analysis and prompt guidance beyond TypeScript
- v0.4 carryover hardening where it materially improves operator trust and review quality

## Latest Release: v0.4 Intelligent Review System

**Shipped:** 2026-02-12
**Phases:** 26-29 (4 phases, 17 plans)

**Delivered:**
- Configurable review strictness (mode, severity threshold, focus areas, comment caps)
- Context-aware review prompts with deterministic diff analysis and path-scoped instructions
- Repo-scoped knowledge store with explicit suppressions and confidence filtering
- Quantitative Review Details reporting (files, lines, severity counts, time-saved estimate)
- Idempotent thumbs-reaction feedback capture linked to persisted findings

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

### Active

(No active requirements — next milestone will define new requirements)

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
- **Telemetry:** SQLite WAL database at `./data/kodiai-telemetry.db` with 90-day retention
- **Codebase:** ~12,880 lines of TypeScript, 178 tests passing

## Current State

v0.4 ships an installable GitHub App that:
- Automatically reviews PRs with inline comments, suggestions, and optional silent approvals
- Responds to `@kodiai` mentions across GitHub comment surfaces with write-mode support
- Adapts review behavior via per-repo mode/severity/focus/profile/path-instruction controls
- Applies deterministic diff/risk context before LLM review for targeted findings
- Persists review findings and suppression context in a SQLite knowledge store
- Filters low-confidence and explicitly suppressed findings from visible inline output
- Captures thumbs-up/down feedback reactions for future learning analysis
- Records usage telemetry (tokens, cost, duration) for every execution
- Provides per-repo configuration via `.kodiai.yml` (review control, mention allowlists, write-mode guardrails, telemetry opt-out)
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

---
*Last updated: 2026-02-13 after v0.5 milestone kickoff*

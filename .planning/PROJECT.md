# Kodiai

## What This Is

Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews and conversational code assistance via `@kodiai` mentions. It replaces the current approach of forking `anthropics/claude-code-action` and maintaining workflow YAML files in every repo — instead, repos just install the app and optionally drop a `.kodiai.yml` config file.

## Core Value

When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, or contextual answers to questions — without requiring any workflow setup in the target repo.

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

### Active

- [ ] Code modification via @mention (branch creation, commit, push) with guardrails
- [ ] Durable idempotency/locking (reduce race risk beyond marker checks)
- [ ] Expand operator evidence capture (GitHub delivery metadata access + richer log correlation tooling)

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

## Current State

v0.1 ships an installable GitHub App that:
- Automatically reviews PRs (inline comments + suggestions; silent approvals for clean PRs)
- Responds to `@kodiai` mentions across GitHub comment surfaces
- Is deployable and running in production with observability and runbooks

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

---
*Last updated: 2026-02-09 after v0.1 milestone*

# Kodiai

## What This Is

Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews and conversational code assistance via `@kodiai` mentions. It replaces the current approach of forking `anthropics/claude-code-action` and maintaining workflow YAML files in every repo — instead, repos just install the app and optionally drop a `.kodiai.yml` config file.

## Core Value

When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, or contextual answers to questions — without requiring any workflow setup in the target repo.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Webhook server receives GitHub events and verifies signatures
- [ ] GitHub App authenticates via JWT and mints installation tokens
- [ ] Event router classifies webhooks and dispatches to handlers
- [ ] Per-repo `.kodiai.yml` config loaded from default branch with sensible defaults
- [ ] PR auto-review on open/ready_for_review using Claude Code CLI
- [ ] Inline review comments with suggestion blocks via MCP server
- [ ] `@kodiai` mention handling in issue comments, PR comments, review comments, and review bodies
- [ ] Mention handler supports code modifications (branch creation, commits, pushes)
- [ ] Tracking comments show progress during long-running jobs
- [ ] Fork PR support works natively (no workflow workarounds)
- [ ] Content sanitization (tokens, invisible chars, HTML comments)
- [ ] TOCTOU protections for comment filtering
- [ ] Bot ignores its own comments (no infinite loops)
- [ ] Permission checks (bot filtering, write-access validation)
- [ ] Job queue with per-installation concurrency limits
- [ ] Eyes emoji reaction on trigger comments
- [ ] Deployed to Azure Container Apps with Docker
- [ ] Unit and integration tests for key modules

### Out of Scope

- Direct SDK agent loop for non-Claude LLMs — Phase 2+ after v1 is stable
- Bedrock / Vertex / API key auth backends — OAuth only for v1
- Public GitHub Marketplace listing — small group of known users for now
- Real-time streaming UI or dashboard — GitHub comments are the interface
- CI/CD pipeline automation — deployment is manual or separate

## Context

- **Reference code:** Forked `claude-code-action` and `claude-code-base-action` are cloned in `tmp/` for porting. These contain battle-tested GraphQL queries, MCP servers, prompt generation, sanitization, and the Agent SDK invocation pattern.
- **Current setup:** xbmc repo uses forked action + custom workflow YAML. This works but requires per-repo workflow files, ugly fork PR workarounds, and burns GitHub Actions minutes.
- **Execution backend:** Claude Code CLI via `@anthropic-ai/claude-agent-sdk` `query()`. The CLI provides the full toolchain (file editing, MCP servers, tool use) for free.
- **MCP servers to port:** 4 servers from the action — comment updates, inline review comments, CI status reading, file ops via Git Data API.
- **GitHub App:** Not yet registered. Will be created as part of this project with the required permissions (contents:write, issues:write, pull_requests:write, actions:read, metadata:read, checks:read).

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
| Bun + Hono over Node + Express | Bun is fast, has native TypeScript support, Hono is lightweight and runs anywhere | — Pending |
| Claude Code CLI over direct API calls | Gets full Claude Code toolchain for free — file editing, MCP, tool use | — Pending |
| In-process p-queue over external queue | Simpler to start; can migrate to Azure Service Bus later if needed | — Pending |
| Shallow clone per job | Avoids large repo downloads; 50 commits gives enough diff context | — Pending |
| `.kodiai.yml` config over env vars | Per-repo customization without touching the app server | — Pending |

---
*Last updated: 2026-02-07 after initialization*

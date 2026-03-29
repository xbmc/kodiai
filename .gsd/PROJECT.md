# Kodiai

AI-powered GitHub App delivering code review, conversational assistance, issue intelligence, and Slack integration for Kodi repositories. One installation replaces per-repo workflow YAML.

## Core Value

Automated review and rule enforcement that reduces maintainer burden on high-volume repos — especially the Kodi addon repositories.

## Current State

26 milestones shipped (M001–M030). Deployed to Azure Container Apps. Core capabilities operational: PR review, @kodiai mentions, issue triage, Slack assistant, wiki knowledge system (5-corpus hybrid retrieval with BM25 + pgvector), review pattern clustering, wiki staleness/popularity scoring, epistemic guardrails, contributor profiles, addon rule enforcement.

M031 (Security Hardening) complete — env allowlist (`src/execution/env.ts`), git remote sanitization, outgoing secret scan at MCP layer, CLAUDE.md injection, prompt refusal instructions.

M032 (Agent Process Isolation) complete — agent subprocess moved to ephemeral Azure Container Apps Job with zero application secrets in its environment. `buildAcaJobSpec` enforces `APPLICATION_SECRET_NAMES` contract (9 forbidden names, throws at build time if any appear). MCP servers remain in orchestrator and are exposed over authenticated HTTP (`createMcpJobRegistry` + `createMcpHttpRoutes`; per-job 32-byte bearer token). Workspace shared via Azure Files mount (`createAzureFilesWorkspaceDir`). `src/execution/agent-entrypoint.ts` is the job container entry point. `createExecutor()` fully refactored to ACA dispatch path. `Dockerfile.agent` created. `bun run verify:m032` exits 0 (3 security contract checks). Closes the `/proc/<ppid>/environ` prompt-injection-to-exfiltration attack path structurally.

## Architecture / Key Patterns

- **Runtime:** Bun + Hono HTTP server, PostgreSQL + pgvector, deployed to Azure Container Apps
- **Webhook dispatch:** Map-keyed handler registry (`webhook/router.ts`); handlers register by `"event.action"` key
- **Job queue:** Per-installation concurrency control via `jobs/queue.ts`; handlers enqueue jobs, not execute inline
- **Workspace manager:** Ephemeral git clones per job (`jobs/workspace.ts`); stale workspaces cleaned on boot
- **Executor:** Claude Agent SDK wrapper dispatches ACA Job; per-job bearer token registered in MCP registry; Azure Files workspace; CLAUDE.md injected; result.json polled on job completion (`execution/executor.ts`)
- **Agent entrypoint:** ACA job container script; env validation, CLAUDE.md write, 7 MCP server configs (HTTP transport), SDK invocation, result.json write (`execution/agent-entrypoint.ts`)
- **MCP HTTP server:** Per-job bearer token registry + Hono routes at `/internal/mcp/:serverName`; stateless (per-request fresh transport+server instances); mounted at root in orchestrator (`execution/mcp/http-server.ts`)
- **Knowledge system:** 5-corpus retrieval (learning memories, review comments, wiki, code snippets, issues) with cross-corpus RRF merging (`knowledge/retrieval.ts`)
- **Wiki sync:** MediaWiki RecentChanges-based incremental sync on 24h schedule; embeddings via voyage-context-3
- **Guardrail pipeline:** Post-processing on all LLM output for epistemic quality (`lib/guardrail/pipeline.ts`)
- **Config:** Per-repo `.kodiai.yml` loaded per job; global env-var config via Zod schema in `src/config.ts`

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- ✅ M001–M030: Core platform through addon rule enforcement (see CHANGELOG.md)
- ✅ M031: Security Hardening — credential exfiltration prevention (env allowlist, git remote sanitization, outgoing secret scan, prompt refusal instructions, CLAUDE.md in workspace)
- ✅ M032: Agent Process Isolation — ephemeral ACA Job sandbox complete. Agent subprocess moved to a secrets-free ACA Job container; MCP servers exposed over per-job bearer-token authenticated HTTP from orchestrator; workspace on Azure Files share. APPLICATION_SECRET_NAMES security contract enforced at build time. `bun run verify:m032` exits 0.

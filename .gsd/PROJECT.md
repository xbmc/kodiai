# Kodiai

AI-powered GitHub App delivering code review, conversational assistance, issue intelligence, and Slack integration for Kodi repositories. One installation replaces per-repo workflow YAML.

## Core Value

Automated review and rule enforcement that reduces maintainer burden on high-volume repos — especially the Kodi addon repositories.

## Current State

25 milestones shipped (M001–M029). Deployed to Azure Container Apps. Core capabilities operational: PR review, @kodiai mentions, issue triage, Slack assistant, wiki knowledge system (5-corpus hybrid retrieval with BM25 + pgvector), review pattern clustering, wiki staleness/popularity scoring, epistemic guardrails, contributor profiles.

M030 (Addon Rule Enforcement) is in progress — S01 complete. Handler scaffold fires on PR events for configured addon repos and logs the addon IDs it would check.

## Architecture / Key Patterns

- **Runtime:** Bun + Hono HTTP server, PostgreSQL + pgvector, deployed to Azure Container Apps
- **Webhook dispatch:** Map-keyed handler registry (`webhook/router.ts`); handlers register by `"event.action"` key
- **Job queue:** Per-installation concurrency control via `jobs/queue.ts`; handlers enqueue jobs, not execute inline
- **Workspace manager:** Ephemeral git clones per job (`jobs/workspace.ts`); stale workspaces cleaned on boot
- **Executor:** Claude Agent SDK wrapper with model routing, MCP tools, cost tracking (`execution/executor.ts`)
- **Knowledge system:** 5-corpus retrieval (learning memories, review comments, wiki, code snippets, issues) with cross-corpus RRF merging (`knowledge/retrieval.ts`)
- **Wiki sync:** MediaWiki RecentChanges-based incremental sync on 24h schedule; embeddings via voyage-context-3
- **Guardrail pipeline:** Post-processing on all LLM output for epistemic quality (`lib/guardrail/pipeline.ts`)
- **Config:** Per-repo `.kodiai.yml` loaded per job; global env-var config via Zod schema in `src/config.ts`

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- ✅ M001–M029: Core platform through wiki quality (see CHANGELOG.md)
- 🔄 M030: Addon Rule Enforcement — S01 complete (handler scaffold + repo detection); S02 (checker subprocess), S03 (PR comment posting) pending
- [ ] M031: Security Hardening — credential exfiltration prevention (env allowlist, git remote sanitization, outgoing secret scan, prompt refusal instructions, CLAUDE.md in workspace)

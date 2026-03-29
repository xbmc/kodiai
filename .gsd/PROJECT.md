# Kodiai

AI-powered GitHub App delivering code review, conversational assistance, issue intelligence, and Slack integration for Kodi repositories. One installation replaces per-repo workflow YAML.

## Core Value

Automated review and rule enforcement that reduces maintainer burden on high-volume repos — especially the Kodi addon repositories.

## Current State

26 milestones shipped (M001–M030). Deployed to Azure Container Apps. Core capabilities operational: PR review, @kodiai mentions, issue triage, Slack assistant, wiki knowledge system (5-corpus hybrid retrieval with BM25 + pgvector), review pattern clustering, wiki staleness/popularity scoring, epistemic guardrails, contributor profiles, addon rule enforcement.

M030 (Addon Rule Enforcement) complete — PRs to xbmc/repo-plugins, xbmc/repo-scripts, and xbmc/repo-scrapers now trigger kodi-addon-checker against all affected addon directories. Findings are posted as an idempotent PR comment (marker-based upsert). Fork PRs handled via base-branch clone + fetchAndCheckoutPullRequestHeadRef. kodi-addon-checker installed in the production Dockerfile via python3 + pip3. All 10 active requirements validated.

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

- ✅ M001–M030: Core platform through addon rule enforcement (see CHANGELOG.md)
- ✅ M031: Security Hardening — credential exfiltration prevention (env allowlist, git remote sanitization, outgoing secret scan, prompt refusal instructions, CLAUDE.md in workspace)
- [ ] M032: Agent Process Isolation — ephemeral ACA Job sandbox (agent subprocess moved to secrets-free container; MCP servers exposed over authenticated HTTP from orchestrator; workspace on Azure Files share)
  - ✅ S01: ACA Job + Azure Files Infrastructure — `buildAcaJobSpec` with APPLICATION_SECRET_NAMES security contract (9 forbidden names), `launchAcaJob`/`pollUntilComplete`/`readJobResult` in `src/jobs/aca-launcher.ts`; `createAzureFilesWorkspaceDir` in workspace.ts; `scripts/test-aca-job.ts` contract check + live smoke test; `deploy.sh` extended with Storage Account, Azure Files share, ACA env storage mount, and ACA Job create/update

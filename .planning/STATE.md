# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.
**Current focus:** Phase 4 in progress - PR Auto-Review. Review config and prompt builder complete.

## Current Position

Phase: 4 of 8 (PR Auto-Review)
Plan: 1 of 4 in current phase
Status: In progress
Last activity: 2026-02-08 -- Completed 04-01-PLAN.md (review config schema + prompt builder)

Progress: [#########-----------] 30% (9/30 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 9
- Average duration: 3min
- Total execution time: 30min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-webhook-foundation | 3/3 | 11min | 4min |
| 02-job-infrastructure | 2/2 | 8min | 4min |
| 03-execution-engine | 3/3 | 9min | 3min |
| 04-pr-auto-review | 1/4 | 2min | 2min |

**Recent Trend:**
- Last 5 plans: 4min, 3min, 3min, 3min, 2min
- Trend: stable/improving

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8 phases derived from dependency chain (webhook -> job infra -> execution -> features -> safety -> ops -> deploy)
- [Roadmap]: Phases 4 and 5 both depend on Phase 3 (could parallelize but sequenced for simplicity)
- [Roadmap]: Content safety (sanitization, TOCTOU) split into own phase for independent verification
- [01-01]: Zod v4 used (latest); backward-compatible with v3 schema patterns
- [01-01]: loadConfig() is async to support file-based private key loading
- [01-01]: Deduplicator uses insert-count-based cleanup (every 1000) not timer-based
- [01-01]: Factory function pattern established for all module exports (createLogger, createDeduplicator, etc.)
- [01-02]: Rely on @octokit/auth-app built-in token caching (up to 15K tokens, auto-refresh) -- no custom cache
- [01-02]: Fresh Octokit instance per getInstallationOctokit() call to avoid stale state
- [01-02]: Connectivity check uses 30-second timestamp cache to avoid rate limiting
- [01-02]: App-level Octokit is a singleton; installation-level Octokit is per-call
- [01-03]: Both "event.action" and "event" handlers fire for the same event (specific + catch-all)
- [01-03]: No wildcard handler -- unhandled events silently dropped with debug logging
- [01-03]: installationId defaults to 0 when payload lacks installation field
- [02-01]: PQueue(concurrency: 1) per installation ensures sequential execution within an installation
- [02-01]: Lazy queue creation + idle pruning prevents unbounded Map growth
- [02-01]: getInstallationToken uses createAppAuth directly (not Octokit) for raw token access
- [02-01]: queue.add() return cast to Promise<T> since void only occurs with throwOnTimeout
- [02-02]: Branch validation rejects leading dash, control chars, .., .lock, @{, //, trailing / to prevent git injection
- [02-02]: Token redacted from error messages/stack traces before re-throw to prevent credential leakage
- [02-02]: Stale cleanup threshold is 1 hour for kodiai-* temp dirs
- [02-02]: jobQueue and workspaceManager are local constants in index.ts (not module exports) until Phase 3 wiring
- [02-02]: git clone uses --single-branch --depth=N and .quiet() to suppress token in error output
- [03-01]: Zod v4 `.default({})` on nested objects with inner defaults requires full default value
- [03-01]: js-yaml used for YAML parsing; explicit error messages for parse and validation failures
- [03-01]: loadRepoConfig is a standalone async function (not factory) consistent with loadConfig()
- [03-02]: In-process MCP servers via createSdkMcpServer + tool pattern (no stdio child processes)
- [03-02]: All MCP servers receive getOctokit function (not cached instance) for token freshness
- [03-02]: download_job_log tool not ported (GitHub Actions specific)
- [03-02]: buildMcpServers includes 3 servers for PRs, 1 (comment only) for issues
- [03-03]: permissionMode "bypassPermissions" + allowDangerouslySkipPermissions for headless execution
- [03-03]: settingSources ["project"] loads repo CLAUDE.md
- [03-03]: env spread passes CLAUDE_CODE_OAUTH_TOKEN through process.env
- [03-03]: Read-only tools for Phase 3; Phase 5 adds write tools for mentions
- [03-03]: Executor catches all errors, returns conclusion "error" -- never crashes server
- [04-01]: Review prompt uses (1), (2), (3) format to avoid GitHub auto-linking #N as issue links
- [04-01]: Silent approval pattern: prompt tells Claude to do nothing on clean PRs, handler manages approval
- [04-01]: Empty PR body omitted from prompt rather than showing empty section

### Pending Todos

None yet.

### Blockers/Concerns

- GitHub App not yet registered (needed before Phase 1 can be tested with real webhooks)
- Azure Container Apps not yet provisioned (needed for Phase 8)
- Claude CLI on Alpine may fail (research gap -- test during Phase 8, fall back to debian-slim)

## Session Continuity

Last session: 2026-02-08
Stopped at: Completed 04-01 (review config + prompt builder). Next: 04-02 (PR review handler).
Resume file: .planning/phases/04-pr-auto-review/04-02-PLAN.md

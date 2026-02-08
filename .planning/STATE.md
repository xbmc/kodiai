# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.
**Current focus:** Phase 2 complete - Job Infrastructure. Ready for Phase 3 (Review Execution).

## Current Position

Phase: 2 of 8 (Job Infrastructure)
Plan: 2 of 2 in current phase
Status: Phase complete
Last activity: 2026-02-08 -- Completed 02-02-PLAN.md (workspace manager with ephemeral cloning)

Progress: [#####---------------] 17% (5/30 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 4min
- Total execution time: 19min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-webhook-foundation | 3/3 | 11min | 4min |
| 02-job-infrastructure | 2/2 | 8min | 4min |

**Recent Trend:**
- Last 5 plans: 3min, 3min, 4min, 4min
- Trend: stable

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

### Pending Todos

None yet.

### Blockers/Concerns

- GitHub App not yet registered (needed before Phase 1 can be tested with real webhooks)
- Azure Container Apps not yet provisioned (needed for Phase 8)
- Claude CLI on Alpine may fail (research gap -- test during Phase 8, fall back to debian-slim)

## Session Continuity

Last session: 2026-02-08
Stopped at: Completed 02-02-PLAN.md (workspace manager). Phase 2 complete. Ready for Phase 3 (Review Execution).
Resume file: .planning/phases/03-review-execution/

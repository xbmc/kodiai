# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-11)

**Core value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.
**Current focus:** Phase 24 - Enhanced Config Fields (v0.3)

## Current Position

Phase: 24 (4 of 4 in v0.3) — Enhanced Config Fields
Plan: 2 of 2 complete
Status: Phase complete
Last activity: 2026-02-11 — Phase 24-02 executed (telemetry opt-out + cost warning)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 46 (across v0.1 + v0.2 + v0.3)
- Average duration: 3min
- Total execution time: 271min

**By Phase (v0.3):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 22-config-validation-safety | 1 | 4min | 4min |
| 23-telemetry-foundation | 3 | 11min | 4min |
| 25-reporting-tools | 1 | 2min | 2min |
| 24-enhanced-config-fields | 2 | 10min | 5min |

*Updated after each plan completion*

## Deployment Info

- **FQDN:** ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
- **Webhook URL:** https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github
- **GitHub App ID:** 2822869
- **GitHub App slug:** kodiai

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Two-pass safeParse for config: fast path tries full schema, fallback parses each section independently (22-01)
- Unknown keys silently stripped, no .strict()/.passthrough()/.catch() (22-01)
- LoadConfigResult pattern: all config loading returns { config, warnings } (22-01)
- ExecutionResult token fields use `| undefined` (not optional) for explicit backward compatibility (23-02)
- Error/timeout paths set token fields to undefined (not zero) to distinguish from zero-token executions (23-02)
- [Phase 23-01]: Used RETURNING clause for purge row counting to avoid bun:sqlite db.run() type mismatch with named params
- [Phase 23-01]: File-backed temp databases in tests for verification via second connection (in-memory DBs per-connection)
- [Phase 23-03]: model field defaults to "unknown" when ExecutionResult.model is undefined (error/timeout paths)
- [Phase 23-03]: Telemetry capture inside isolated try-catch, separate from handler main try-catch (TELEM-05 non-blocking)
- [Phase 25-01]: Script opens DB directly with bun:sqlite, does not import from src/
- [Phase 25-01]: No npm dependencies for CLI script - util.parseArgs, bun:sqlite all built into Bun
- [Phase 24-01]: Separate normalizeSkipPattern in review.ts (not reusing workspace.ts) due to additional *.ext normalization need
- [Phase 24-01]: allowedUsers case-insensitive matching; empty list = all users allowed (no gating)
- [Phase 24-02]: Cost warning inside telemetry.enabled gate, so disabling telemetry suppresses both recording and warnings
- [Phase 24-02]: Cost warning posts as GitHub issue comment with formatted USD amounts

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-11
Stopped at: Completed 24-02-PLAN.md (telemetry opt-out + cost warning)
Resume file: None

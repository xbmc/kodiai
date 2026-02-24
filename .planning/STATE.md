# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-23)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 88 - Knowledge Layer Extraction

## Current Position

**Milestone:** v0.18 Knowledge Layer Extraction
**Phase:** 88 (Knowledge Layer Extraction)
**Plan:** 1 of 2 in current phase (plan 01 complete)
**Status:** In progress
**Last Activity:** 2026-02-24

Progress: [#####-----] 50%

## Accumulated Context

### Decisions

All decisions through v0.16 archived to `.planning/PROJECT.md` Key Decisions table.

- **86-01:** Used postgres.js (not pg/drizzle/kysely) for zero-dep tagged-template SQL
- **86-01:** Telemetry executions table renamed to telemetry_events in PostgreSQL schema
- **86-01:** learning_memories embedding as vector(1024) inline column, replacing sqlite-vec virtual table
- **86-02:** All store methods made async (Promise-based) since postgres.js is inherently async
- **86-02:** checkpoint()/close() become no-ops -- connection lifecycle managed by client.ts
- **86-02:** db-path.ts deprecated (not deleted) to avoid breaking imports during migration period
- **86-03:** All LearningMemoryStore methods async (Promise-based) to match postgres.js
- **86-03:** Removed createNoOpStore fallback -- pgvector always available in PostgreSQL
- **86-03:** ON CONFLICT DO NOTHING for duplicate writes instead of catching UNIQUE constraint
- **86-04:** All stores share single PostgreSQL connection pool via createDbClient()
- **86-04:** Removed TELEMETRY_DB_PATH and KNOWLEDGE_DB_PATH env vars -- replaced by single DATABASE_URL
- **86-04:** All handler store calls now properly await async methods (26+ call sites updated)
- **87-01:** Grace window defaults to 5min (SHUTDOWN_GRACE_MS), extends once (doubles) on timeout
- **87-01:** Readiness probe stays healthy during drain (single replica keeps accepting into queue)
- **87-01:** Webhook queue telemetry uses fire-and-forget to avoid blocking enqueue
- **87-02:** /healthz runs SELECT 1 against PostgreSQL for liveness; /health kept as backward-compatible alias
- **87-02:** Startup webhook replay processes sequentially to avoid overwhelming system on cold start
- **87-02:** Termination grace period set to 330s (5min SHUTDOWN_GRACE_MS + 30s buffer)
- **88-01:** Multi-query first-class: queries[] array maps to variant types (intent, file-path, code-shape)
- **88-01:** Factory pattern: createRetriever(deps) returns { retrieve(opts) } for dependency injection
- **88-01:** Fail-open pipeline: entire retrieve() wrapped in try/catch returning null on failure
- **88-01:** Learning types merged into knowledge/types.ts (single canonical location)

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- Checkpoint publishing must use buffer-and-flush on abort, not streaming

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |
| 5 | Merge feat/issue-write-pr to main and redeploy to Azure | 2026-02-19 | e5bc338ce4 | [5-merge-feat-issue-write-pr-to-main-and-re](./quick/5-merge-feat-issue-write-pr-to-main-and-re/) |
| 6 | Extensive code review of entire codebase (97 files, 23,570 lines) | 2026-02-20 | ae782876aa | [6-extensive-code-review](./quick/6-extensive-code-review/) |

## Session Continuity

**Last session:** 2026-02-24T23:38:30Z
**Stopped At:** Completed 88-01-PLAN.md
**Resume File:** .planning/phases/88-knowledge-layer-extraction/88-01-SUMMARY.md
**Next action:** Execute 88-02-PLAN.md (update handler imports, clean up src/learning/)

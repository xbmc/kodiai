# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-23)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 87 - Graceful Shutdown + Deploy Hardening

## Current Position

**Milestone:** v0.17 Infrastructure Foundation
**Phase:** 87 of 88 (Graceful Shutdown + Deploy Hardening)
**Plan:** 0 of ? in current phase
**Status:** Phase 86 complete, Phase 87 not started
**Last Activity:** 2026-02-24 — Completed 86-04 (Azure deploy verified, PostgreSQL migration complete)

Progress: [##########] 100%

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

**Last session:** 2026-02-24T06:02:00Z
**Stopped At:** Completed 86-04-PLAN.md (Phase 86 complete)
**Resume File:** .planning/phases/86-postgresql-pgvector-on-azure/86-04-SUMMARY.md
**Next action:** Plan Phase 87 (Graceful Shutdown + Deploy Hardening)

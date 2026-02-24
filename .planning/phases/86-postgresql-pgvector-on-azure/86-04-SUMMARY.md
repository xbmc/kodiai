---
phase: 86-postgresql-pgvector-on-azure
plan: 04
subsystem: database
tags: [postgresql, postgres.js, migration, sqlite-removal, ci, docker, pgvector, azure]

# Dependency graph
requires:
  - phase: 86-02
    provides: "PostgreSQL-backed KnowledgeStore and TelemetryStore with async interfaces"
  - phase: 86-03
    provides: "PostgreSQL-backed LearningMemoryStore with pgvector"
provides:
  - "Unified PostgreSQL entry point (all stores share single connection pool)"
  - "SQLite-to-PostgreSQL one-time migration script"
  - "CI workflow with pgvector/pgvector:pg17 service container"
  - "Zero SQLite dependencies in application code (src/)"
  - "Updated Dockerfile without SQLite data directory"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [shared PostgreSQL connection pool across all stores, async store method calls throughout handler layer]

key-files:
  created:
    - scripts/migrate-sqlite-to-postgres.ts
  modified:
    - src/index.ts
    - src/handlers/review.ts
    - src/handlers/mention.ts
    - src/handlers/feedback-sync.ts
    - src/handlers/dep-bump-merge-history.ts
    - src/feedback/aggregator.ts
    - src/feedback/index.ts
    - src/execution/mention-context.ts
    - src/lib/incremental-diff.ts
    - .github/workflows/ci.yml
    - Dockerfile
    - package.json

key-decisions:
  - "All stores share single PostgreSQL connection pool via createDbClient() -- no per-store connections"
  - "Removed TELEMETRY_DB_PATH and KNOWLEDGE_DB_PATH env vars -- replaced by single DATABASE_URL"
  - "Migration script uses @ts-nocheck for dynamic SQLite row data (one-time tool, not runtime)"
  - "All handler store calls now properly await async methods (26+ call sites updated)"

patterns-established:
  - "Database initialization: createDbClient() + runMigrations() before store creation"
  - "Store factory pattern: createXxxStore({ sql, logger }) with shared sql instance"
  - "All store interactions in handlers must use await (enforced by TypeScript async types)"

requirements-completed: [DB-03, DB-05, DB-06, DB-07]

# Metrics
duration: 17min
completed: 2026-02-24
---

# Phase 86 Plan 04: Integration Wiring and SQLite Removal Summary

**Unified PostgreSQL entry point with shared connection pool, all handler async calls fixed, SQLite fully removed from application, CI running against pgvector**

## Performance

- **Duration:** 17 min
- **Started:** 2026-02-24T05:00:19Z
- **Completed:** 2026-02-24T05:17:04Z
- **Tasks:** 2 of 3 (task 3 is human verification checkpoint)
- **Files modified:** 17

## Accomplishments
- Application entry point rewritten to use single shared PostgreSQL connection pool for all 3 stores
- 26+ async store method call sites updated across handlers, feedback modules, and utilities
- One-time SQLite-to-PostgreSQL migration script created for all 14 tables including pgvector embeddings
- sqlite-vec removed from dependencies, Dockerfile cleaned of SQLite data directory
- CI workflow updated with pgvector/pgvector:pg17 service container and health checks
- All 1116 tests passing across 67 files against Docker Compose PostgreSQL

## Task Commits

Each task was committed atomically:

1. **Task 1: Update application entry point, create migration script, clean up SQLite** - `d3ad130912` (feat)
2. **Task 2: Update CI for PostgreSQL and run full integration test suite** - `5379af76fa` (feat)
3. **Task 3: Verify PostgreSQL swap and approve Azure deploy** - checkpoint:human-verify (pending)

## Files Created/Modified
- `src/index.ts` - Unified PostgreSQL initialization, removed all SQLite imports and env vars
- `scripts/migrate-sqlite-to-postgres.ts` - One-time data migration from SQLite to PostgreSQL
- `src/handlers/review.ts` - Added await to 15+ async store/telemetry calls
- `src/handlers/mention.ts` - Added await to telemetry.record and findingLookup calls
- `src/handlers/feedback-sync.ts` - Awaited listRecentFindingCommentCandidates and recordFeedbackReactions
- `src/handlers/dep-bump-merge-history.ts` - Awaited recordDepBumpMergeHistory
- `src/feedback/aggregator.ts` - Made aggregateSuppressiblePatterns async
- `src/feedback/index.ts` - Made evaluateFeedbackSuppressions async
- `src/execution/mention-context.ts` - Updated findingLookup type to accept Promise, added await
- `src/lib/incremental-diff.ts` - Updated getLastReviewedHeadSha type to accept Promise, added await
- `.github/workflows/ci.yml` - Added PostgreSQL service container with pgvector
- `Dockerfile` - Removed SQLite data directory, added DATABASE_URL documentation
- `package.json` - Removed sqlite-vec, added migrate:sqlite-to-pg script
- `src/handlers/review.test.ts` - Updated all mock stores to return Promises
- `src/handlers/mention.test.ts` - Updated noopTelemetryStore to async
- `src/feedback/aggregator.test.ts` - Updated tests for async aggregator
- `src/feedback/confidence-adjuster.test.ts` - Updated tests for async evaluator

## Decisions Made
- All stores share single PostgreSQL connection pool -- simpler than per-store connections, matching the postgres.js pooling model
- Removed TELEMETRY_DB_PATH and KNOWLEDGE_DB_PATH env vars entirely -- single DATABASE_URL replaces both
- Migration script uses @ts-nocheck since it handles dynamic SQLite row data and is a one-time tool
- All 26+ handler store calls updated to use await -- TypeScript now enforces this via async return types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed unawaited async store calls across handler layer**
- **Found during:** Task 1 (entry point rewrite)
- **Issue:** After 86-02 made all store methods async, ~26 call sites in review.ts, mention.ts, feedback-sync.ts, dep-bump-merge-history.ts, and utility modules were calling async methods without await
- **Fix:** Added await to every store method call; updated callback types in incremental-diff.ts and mention-context.ts to accept Promises; made aggregateSuppressiblePatterns and evaluateFeedbackSuppressions async
- **Files modified:** src/handlers/review.ts, src/handlers/mention.ts, src/handlers/feedback-sync.ts, src/handlers/dep-bump-merge-history.ts, src/feedback/aggregator.ts, src/feedback/index.ts, src/execution/mention-context.ts, src/lib/incremental-diff.ts
- **Verification:** bunx tsc --noEmit passes for all modified files; all 1116 tests pass
- **Committed in:** d3ad130912 (Task 1 commit)

**2. [Rule 3 - Blocking] Updated test mocks for async store interfaces**
- **Found during:** Task 1 (entry point rewrite)
- **Issue:** Test mock objects in review.test.ts, mention.test.ts, aggregator.test.ts, confidence-adjuster.test.ts returned synchronous values while types now require Promises
- **Fix:** Added async keyword to all mock store method definitions; updated test callbacks to use async/await
- **Files modified:** src/handlers/review.test.ts, src/handlers/mention.test.ts, src/feedback/aggregator.test.ts, src/feedback/confidence-adjuster.test.ts
- **Verification:** All 1116 tests pass
- **Committed in:** d3ad130912 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes required for correct async behavior after store interface migration. No scope creep -- all changes are direct consequences of the sync-to-async store migration.

## Issues Encountered
- Pre-existing TypeScript errors in knowledge/store.ts (TransactionSql type issues from 86-02) remain -- these are not caused by this plan and do not affect runtime behavior.

## User Setup Required
Before Azure deploy:
1. Run `bash scripts/provision-postgres.sh` to create Azure PostgreSQL Flexible Server
2. Run `DATABASE_URL=<azure-connection-string> bun scripts/migrate-sqlite-to-postgres.ts` to migrate data
3. Add `DATABASE_URL` to Azure Container Apps secrets
4. Deploy and verify health endpoint returns 200

## Next Phase Readiness
- Application fully running on PostgreSQL -- SQLite completely removed from runtime
- CI configured for PostgreSQL testing
- Ready for Azure deploy after human verification (Task 3 checkpoint)

---
*Phase: 86-postgresql-pgvector-on-azure*
*Completed: 2026-02-24*

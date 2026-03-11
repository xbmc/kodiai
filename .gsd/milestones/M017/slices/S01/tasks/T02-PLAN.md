# T02: 86-postgresql-pgvector-on-azure 02

**Slice:** S01 — **Milestone:** M017

## Description

Port the KnowledgeStore and TelemetryStore from bun:sqlite to postgres.js. Both stores keep their existing interface (KnowledgeStore type, TelemetryStore type) but use PostgreSQL queries internally.

Purpose: Replace the two largest SQLite consumers with PostgreSQL. The stores accept a postgres.js `sql` instance via dependency injection, replacing the `Database` parameter.

Output: Rewritten store.ts files for knowledge/ and telemetry/, updated tests, removed db-path module.

## Must-Haves

- [ ] "KnowledgeStore uses postgres.js for all queries instead of bun:sqlite"
- [ ] "TelemetryStore uses postgres.js for all queries instead of bun:sqlite"
- [ ] "All KnowledgeStore methods return identical types/shapes as the SQLite version"
- [ ] "All TelemetryStore methods return identical types/shapes as the SQLite version"
- [ ] "No bun:sqlite or sqlite-vec imports remain in knowledge/ or telemetry/ directories"
- [ ] "db-path module is replaced with DATABASE_URL-based connection"
- [ ] "Existing tests pass against Docker Compose PostgreSQL"

## Files

- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/knowledge/db-path.ts`
- `src/knowledge/db-path.test.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`

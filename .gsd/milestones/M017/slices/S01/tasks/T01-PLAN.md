# T01: 86-postgresql-pgvector-on-azure 01

**Slice:** S01 — **Milestone:** M017

## Description

Create the PostgreSQL foundation: Azure provisioning script, unified schema with all tables from knowledge/telemetry/learning stores, pgvector HNSW indexes, tsvector full-text search columns, a versioned migration runner, and a postgres.js client module.

Purpose: Establish the database layer that all subsequent plans build on. No SQLite code is changed yet -- this plan only creates new PostgreSQL infrastructure.

Output: Provisioning script, docker-compose for local dev, migration SQL files, migration runner, and postgres.js client module.

## Must-Haves

- [ ] "Azure CLI script provisions PostgreSQL Flexible Server with pgvector enabled"
- [ ] "Database schema defines all tables matching current SQLite structure with PostgreSQL idioms"
- [ ] "HNSW indexes exist on vector columns with tuned parameters"
- [ ] "tsvector columns and GIN indexes exist for full-text search"
- [ ] "Migration runner applies versioned SQL files in order and tracks state"
- [ ] "Rollback function reverts migrations to a target version using paired down files"
- [ ] "postgres.js client connects via DATABASE_URL and exports a reusable sql tagged-template instance"

## Files

- `scripts/provision-postgres.sh`
- `src/db/client.ts`
- `src/db/migrations/001-initial-schema.sql`
- `src/db/migrations/001-initial-schema.down.sql`
- `src/db/migrations/002-pgvector-indexes.sql`
- `src/db/migrations/002-pgvector-indexes.down.sql`
- `src/db/migrations/003-tsvector-columns.sql`
- `src/db/migrations/003-tsvector-columns.down.sql`
- `src/db/migrate.ts`
- `docker-compose.yml`

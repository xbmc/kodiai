# S01: Postgresql Pgvector On Azure

**Goal:** Create the PostgreSQL foundation: Azure provisioning script, unified schema with all tables from knowledge/telemetry/learning stores, pgvector HNSW indexes, tsvector full-text search columns, a versioned migration runner, and a postgres.
**Demo:** Create the PostgreSQL foundation: Azure provisioning script, unified schema with all tables from knowledge/telemetry/learning stores, pgvector HNSW indexes, tsvector full-text search columns, a versioned migration runner, and a postgres.

## Must-Haves


## Tasks

- [x] **T01: 86-postgresql-pgvector-on-azure 01** `est:5min`
  - Create the PostgreSQL foundation: Azure provisioning script, unified schema with all tables from knowledge/telemetry/learning stores, pgvector HNSW indexes, tsvector full-text search columns, a versioned migration runner, and a postgres.js client module.

Purpose: Establish the database layer that all subsequent plans build on. No SQLite code is changed yet -- this plan only creates new PostgreSQL infrastructure.

Output: Provisioning script, docker-compose for local dev, migration SQL files, migration runner, and postgres.js client module.
- [x] **T02: 86-postgresql-pgvector-on-azure 02** `est:7min`
  - Port the KnowledgeStore and TelemetryStore from bun:sqlite to postgres.js. Both stores keep their existing interface (KnowledgeStore type, TelemetryStore type) but use PostgreSQL queries internally.

Purpose: Replace the two largest SQLite consumers with PostgreSQL. The stores accept a postgres.js `sql` instance via dependency injection, replacing the `Database` parameter.

Output: Rewritten store.ts files for knowledge/ and telemetry/, updated tests, removed db-path module.
- [x] **T03: 86-postgresql-pgvector-on-azure 03** `est:9min`
  - Port the LearningMemoryStore from sqlite-vec to postgres.js + pgvector. Replace the vec0 virtual table with native pgvector vector columns and HNSW index queries. Update all retrieval pipeline modules that depend on the store.

Purpose: Eliminate the sqlite-vec dependency and use pgvector's native HNSW indexes for vector similarity search, which is the core capability enabling learning memory retrieval.

Output: Rewritten memory-store.ts using pgvector, updated retrieval pipeline modules, passing tests.
- [x] **T04: 86-postgresql-pgvector-on-azure 04** `est:17min`
  - Wire everything together: update the application entry point to use PostgreSQL, create the SQLite-to-PostgreSQL migration script, update CI to test against PostgreSQL, remove all SQLite dependencies, update Dockerfile, and verify on Azure.

Purpose: Complete the infrastructure swap. After this plan, SQLite is fully gone and the application runs entirely on PostgreSQL.

Output: Working application on PostgreSQL, data migrated, CI green, SQLite dependencies removed.

## Files Likely Touched

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
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/knowledge/db-path.ts`
- `src/knowledge/db-path.test.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/learning/memory-store.ts`
- `src/learning/memory-store.test.ts`
- `src/learning/retrieval-query.ts`
- `src/learning/retrieval-query.test.ts`
- `src/learning/retrieval-rerank.ts`
- `src/learning/retrieval-rerank.test.ts`
- `src/learning/multi-query-retrieval.ts`
- `src/learning/multi-query-retrieval.test.ts`
- `src/index.ts`
- `scripts/migrate-sqlite-to-postgres.ts`
- `Dockerfile`
- `.github/workflows/ci.yml`
- `package.json`

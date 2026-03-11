# T04: 86-postgresql-pgvector-on-azure 04

**Slice:** S01 — **Milestone:** M017

## Description

Wire everything together: update the application entry point to use PostgreSQL, create the SQLite-to-PostgreSQL migration script, update CI to test against PostgreSQL, remove all SQLite dependencies, update Dockerfile, and verify on Azure.

Purpose: Complete the infrastructure swap. After this plan, SQLite is fully gone and the application runs entirely on PostgreSQL.

Output: Working application on PostgreSQL, data migrated, CI green, SQLite dependencies removed.

## Must-Haves

- [ ] "Application boots and connects to PostgreSQL via DATABASE_URL"
- [ ] "Existing SQLite data is migrated to PostgreSQL via migration script"
- [ ] "CI runs tests against Dockerized PostgreSQL with pgvector"
- [ ] "No bun:sqlite, sqlite-vec, or better-sqlite3 imports exist anywhere in src/"
- [ ] "sqlite-vec removed from package.json dependencies"
- [ ] "Dockerfile no longer creates /app/data for SQLite"
- [ ] "Application works end-to-end on Azure after deploy"

## Files

- `src/index.ts`
- `scripts/migrate-sqlite-to-postgres.ts`
- `Dockerfile`
- `.github/workflows/ci.yml`
- `package.json`

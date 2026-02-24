# Phase 86: PostgreSQL + pgvector on Azure - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace SQLite with PostgreSQL on Azure Flexible Server. Migrate all persistent data (PRs, issues, embeddings), enable pgvector HNSW indexes for vector similarity, add tsvector columns for full-text search, and fully remove SQLite/sqlite-vec dependencies. No new features — pure infrastructure swap.

</domain>

<decisions>
## Implementation Decisions

### Migration strategy
- Big-bang cutover — run migration, switch, deploy. No dual-write period.
- Separate manual migration step — run script explicitly, verify data, then deploy Postgres-backed code.
- Keep SQLite file as backup on disk for rollback period. Forward-fix preferred but revert path exists.

### Claude's Discretion (Migration)
- Migration script approach (Node script vs SQL export/import) — Claude picks based on data volume and schema complexity.

### Schema design
- Redesign where it helps — keep structure similar to SQLite but fix pain points, normalize where SQLite forced denormalization, improve column names.
- Use a migration framework for ongoing schema changes (versioned up/down migrations, tracked state).

### Claude's Discretion (Schema)
- DB client library choice (Drizzle, Kysely, raw pg) — Claude evaluates codebase patterns and picks.
- Embedding storage layout (inline vs separate table) — Claude decides based on current data model.

### Azure provisioning
- Burstable tier (B-series) Flexible Server — cheapest, fits low-traffic bot profile.
- Connection string via `DATABASE_URL` env var in Azure Container Apps secrets — consistent with current pattern.
- Azure CLI script for provisioning — reproducible, version-controlled, no extra tooling.
- Direct connection to Postgres — no PgBouncer needed given single-instance, low-concurrency setup.

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 86-postgresql-pgvector-on-azure*
*Context gathered: 2026-02-23*

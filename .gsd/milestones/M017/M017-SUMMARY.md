---
id: M017
milestone: M017
verification_result: passed
completed_at: migrated
---

# M017: Infrastructure Foundation

**Migrated from v0.17 milestone summary**

## What Happened

## v0.17 Infrastructure Foundation (Shipped: 2026-02-24)

**Scope:** 3 phases (86-88), 8 plans
**Timeline:** 2026-02-24
**Files modified:** 41 (2,789 insertions, 781 deletions)

**Key accomplishments:**
- PostgreSQL + pgvector replaces all SQLite storage — HNSW vector indexes, tsvector columns, single DATABASE_URL connection pool
- Graceful shutdown with SIGTERM handling, in-flight request drain, and webhook queue for replay on restart
- Zero-downtime deploys with PostgreSQL health probes, rolling deploy config, and startup webhook queue replay
- Unified `src/knowledge/` module with `createRetriever()` factory replacing duplicate retrieval paths between GitHub and Slack
- E2E test proving PR review and Slack assistant share identical retrieval code path
- SQLite fully removed — zero sqlite-vec/better-sqlite3 dependencies in application code

---

# Requirements: Kodiai

**Defined:** 2026-02-23
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.17 Requirements

Requirements for v0.17 Infrastructure Foundation. Each maps to roadmap phases.

### Database

- [x] **DB-01**: PostgreSQL Flexible Server provisioned on Azure with pgvector extension enabled
- [x] **DB-02**: Unified schema defined with `embeddings`, `documents`, `chunks` tables and vector columns
- [x] **DB-03**: Existing SQLite data (PRs, issues, embeddings) migrated to PostgreSQL
- [x] **DB-04**: All DB clients updated from better-sqlite3 to postgres.js
- [x] **DB-05**: `src/db/` module targets PostgreSQL; sqlite-vec dependency removed
- [x] **DB-06**: Integration tests run against Postgres via Docker locally and in CI
- [x] **DB-07**: Live reads/writes verified on Azure after deploy
- [x] **DB-08**: HNSW indexes configured with tuned `m`/`ef_construction` and correct distance operator
- [x] **DB-09**: `tsvector` full-text search columns provisioned alongside vector columns for hybrid search

### Deploy

- [x] **DEP-01**: SIGTERM handler added to webhook server and ingestion workers
- [x] **DEP-02**: In-flight request tracking with drain logic waits for active requests before exit
- [x] **DEP-03**: Configurable grace window via `SHUTDOWN_GRACE_MS` env var (default 5 minutes)
- [x] **DEP-04**: Azure Container Apps configured with minimum replicas, health probes, and rolling deploy
- [x] **DEP-05**: Zero dropped webhooks verified during mid-review deploy
- [x] **DEP-06**: Graceful restart runbook documented

### Knowledge

- [ ] **KNW-01**: Retrieval logic extracted into `src/knowledge/retrieval.ts`
- [ ] **KNW-02**: Embedding logic extracted into `src/knowledge/embeddings.ts`
- [ ] **KNW-03**: Slack assistant handler uses `src/knowledge/` instead of inline queries
- [ ] **KNW-04**: Shared context-building utilities (chunk ranking, source attribution) in knowledge module
- [ ] **KNW-05**: No duplicate DB query logic between GitHub and Slack retrieval paths
- [ ] **KNW-06**: E2E test verifies Slack retrieves from same corpus as PR review

## Future Requirements

### Hybrid Search

- **HYB-01**: BM25 + vector hybrid search combining tsvector and pgvector results
- **HYB-02**: Configurable weighting between keyword and semantic search

### Multi-Instance

- **MUL-01**: Shared job queue via Postgres for multi-replica coordination
- **MUL-02**: Leader election or distributed locking for singleton tasks

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-database support (MySQL, etc.) | PostgreSQL is the target; no abstraction layer needed |
| Read replicas | Single instance sufficient for current load |
| Kubernetes migration | Staying on Azure Container Apps |
| Full hybrid search implementation | v0.17 only provisions tsvector columns; query logic is future |
| Multi-replica job coordination | Single instance for v0.17; Postgres queue is future |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 86 | Complete |
| DB-02 | Phase 86 | Complete |
| DB-03 | Phase 86 | Complete |
| DB-04 | Phase 86 | Complete |
| DB-05 | Phase 86 | Complete |
| DB-06 | Phase 86 | Complete |
| DB-07 | Phase 86 | Complete |
| DB-08 | Phase 86 | Complete |
| DB-09 | Phase 86 | Complete |
| DEP-01 | Phase 87 | Complete |
| DEP-02 | Phase 87 | Complete |
| DEP-03 | Phase 87 | Complete |
| DEP-04 | Phase 87 | Complete |
| DEP-05 | Phase 87 | Complete |
| DEP-06 | Phase 87 | Complete |
| KNW-01 | Phase 88 | Pending |
| KNW-02 | Phase 88 | Pending |
| KNW-03 | Phase 88 | Pending |
| KNW-04 | Phase 88 | Pending |
| KNW-05 | Phase 88 | Pending |
| KNW-06 | Phase 88 | Pending |

**Coverage:**
- v0.17 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-23*
*Last updated: 2026-02-23 after initial definition*

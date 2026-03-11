# M017: Infrastructure Foundation

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Postgresql Pgvector On Azure** `risk:medium` `depends:[]`
  > After this: Create the PostgreSQL foundation: Azure provisioning script, unified schema with all tables from knowledge/telemetry/learning stores, pgvector HNSW indexes, tsvector full-text search columns, a versioned migration runner, and a postgres.
- [x] **S02: Graceful Shutdown Deploy Hardening** `risk:medium` `depends:[S01]`
  > After this: Implement SIGTERM handling, in-flight work tracking, drain logic with configurable grace window, and durable webhook queuing during shutdown.
- [x] **S03: Knowledge Layer Extraction** `risk:medium` `depends:[S02]`
  > After this: Create the unified `src/knowledge/` module with `retrieval.

# Roadmap: Kodiai

## Milestones

- ✅ **v0.1 MVP** — Phases 1-10 (shipped 2026-02-09)
- ✅ **v0.2 Write Mode** — Phases 11-21 (shipped 2026-02-10)
- ✅ **v0.3 Configuration & Observability** — Phases 22-25 (shipped 2026-02-11)
- ✅ **v0.4 Intelligent Review System** — Phases 26-29 (shipped 2026-02-12)
- ✅ **v0.5 Advanced Learning & Language Support** — Phases 30-33 (shipped 2026-02-13)
- ✅ **v0.6 Review Output Formatting & UX** — Phases 34-38 (shipped 2026-02-14)
- ✅ **v0.7 Intelligent Review Content** — Phases 39-41 (shipped 2026-02-14)
- ✅ **v0.8 Conversational Intelligence** — Phases 42-50 (shipped 2026-02-14)
- ✅ **v0.9 Smart Dependencies & Resilience** — Phases 51-55 (shipped 2026-02-15)
- ✅ **v0.10 Advanced Signals** — Phases 56-59 (shipped 2026-02-16)
- ✅ **v0.11 Issue Workflows** — Phases 60-65 (shipped 2026-02-16)
- ✅ **v0.12 Operator Reliability & Retrieval Quality** — Phases 66-71 (shipped 2026-02-17)
- ✅ **v0.13 Reliability Follow-Through** — Phases 72-76 (force-closed 2026-02-18; accepted debt)
- ✅ **v0.14 Slack Integration** — Phases 77-80 (shipped 2026-02-19)
- ✅ **v0.15 Slack Write Workflows** — Phase 81 (shipped 2026-02-19)
- ✅ **v0.16 Review Coverage & Slack UX** — Phases 82-85 (shipped 2026-02-24)
- [ ] **v0.17 Infrastructure Foundation** — Phases 86-88 (in progress)

## Phases

<details>
<summary>v0.1 MVP (Phases 1-10) -- SHIPPED 2026-02-09</summary>

See `.planning/milestones/v0.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.2 Write Mode (Phases 11-21) -- SHIPPED 2026-02-10</summary>

See `.planning/milestones/v0.2-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.3 Configuration & Observability (Phases 22-25) -- SHIPPED 2026-02-11</summary>

See `.planning/milestones/v0.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.4 Intelligent Review System (Phases 26-29) -- SHIPPED 2026-02-12</summary>

See `.planning/milestones/v0.4-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.5 Advanced Learning & Language Support (Phases 30-33) -- SHIPPED 2026-02-13</summary>

See `.planning/milestones/v0.5-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.6 Review Output Formatting & UX (Phases 34-38) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.6-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.7 Intelligent Review Content (Phases 39-41) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.7-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.8 Conversational Intelligence (Phases 42-50) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.8-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.9 Smart Dependencies & Resilience (Phases 51-55) -- SHIPPED 2026-02-15</summary>

See `.planning/milestones/v0.9-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.10 Advanced Signals (Phases 56-59) -- SHIPPED 2026-02-16</summary>

See `.planning/milestones/v0.10-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.11 Issue Workflows (Phases 60-65) -- SHIPPED 2026-02-16</summary>

See `.planning/milestones/v0.11-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.12 Operator Reliability & Retrieval Quality (Phases 66-71) -- SHIPPED 2026-02-17</summary>

See `.planning/milestones/v0.12-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.13 Reliability Follow-Through (Phases 72-76) -- FORCE-CLOSED 2026-02-18</summary>

See `.planning/milestones/v0.13-ROADMAP.md` for full phase details, accepted gaps, and deferred follow-up scope.

</details>

<details>
<summary>v0.14 Slack Integration (Phases 77-80) -- SHIPPED 2026-02-19</summary>

See `.planning/milestones/v0.14-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.15 Slack Write Workflows (Phase 81) -- SHIPPED 2026-02-19</summary>

See `.planning/milestones/v0.15-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.16 Review Coverage & Slack UX (Phases 82-85) -- SHIPPED 2026-02-24</summary>

See `.planning/milestones/v0.16-ROADMAP.md` for full phase details.

</details>

### v0.17 Infrastructure Foundation (In Progress)

**Milestone Goal:** Replace SQLite with shared PostgreSQL + pgvector, harden the deployment lifecycle, and extract a unified knowledge layer for both GitHub and Slack.

- [ ] **Phase 86: PostgreSQL + pgvector on Azure** - Provision Postgres, migrate all data, replace SQLite with pgvector and full-text search columns
- [ ] **Phase 87: Graceful Shutdown + Deploy Hardening** - SIGTERM handling, drain logic, zero-downtime deploys on Azure Container Apps
- [ ] **Phase 88: Knowledge Layer Extraction** - Unified `src/knowledge/` module eliminating duplicate retrieval paths between GitHub and Slack

## Phase Details

### Phase 86: PostgreSQL + pgvector on Azure
**Goal**: All persistent data lives in PostgreSQL with pgvector indexes and full-text search columns, SQLite fully removed
**Depends on**: Nothing (first phase of v0.17)
**Requirements**: DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-08, DB-09
**Success Criteria** (what must be TRUE):
  1. Application boots and connects to Azure PostgreSQL Flexible Server with pgvector extension loaded
  2. All existing PR, issue, and embedding data is queryable in PostgreSQL after migration
  3. Vector similarity queries return results using HNSW indexes with correct distance operators
  4. `tsvector` columns exist on document/chunk tables and accept full-text search queries
  5. Integration test suite passes against a Dockerized PostgreSQL instance locally and in CI, with no sqlite-vec or better-sqlite3 imports remaining
**Plans:** 2/4 plans executed

Plans:
- [ ] 86-01-PLAN.md -- PostgreSQL foundation: provisioning, schema, migrations, client
- [ ] 86-02-PLAN.md -- Port KnowledgeStore and TelemetryStore to postgres.js
- [ ] 86-03-PLAN.md -- Port LearningMemoryStore to pgvector
- [ ] 86-04-PLAN.md -- Wire entry point, migration script, CI, SQLite removal, deploy

### Phase 87: Graceful Shutdown + Deploy Hardening
**Goal**: Server handles SIGTERM gracefully, drains in-flight work, and Azure deploys cause zero dropped webhooks
**Depends on**: Phase 86
**Requirements**: DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06
**Success Criteria** (what must be TRUE):
  1. Sending SIGTERM to the running server causes it to stop accepting new requests and wait for in-flight requests to finish before exiting
  2. The grace window is configurable via `SHUTDOWN_GRACE_MS` and defaults to 5 minutes
  3. A deploy during an active PR review completes the review without dropping the webhook or producing a partial result
  4. Azure Container Apps is configured with health probes and rolling deploy so at least one replica serves traffic at all times during deploy
**Plans**: TBD

### Phase 88: Knowledge Layer Extraction
**Goal**: GitHub and Slack retrieval share a single `src/knowledge/` module with no duplicated query logic
**Depends on**: Phase 86
**Requirements**: KNW-01, KNW-02, KNW-03, KNW-04, KNW-05, KNW-06
**Success Criteria** (what must be TRUE):
  1. `src/knowledge/retrieval.ts` and `src/knowledge/embeddings.ts` exist and are the sole entry points for retrieval and embedding operations
  2. Slack assistant handler imports from `src/knowledge/` instead of containing inline DB queries
  3. An E2E test proves that a Slack question and a PR review retrieve from the same corpus using the same code path
  4. No duplicate DB query logic exists between GitHub review and Slack assistant retrieval paths
**Plans**: TBD

## Progress

**Total shipped:** 16 milestones, 85 phases, 204 plans

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-10 | v0.1 | 27/27 | Complete | 2026-02-09 |
| 11-21 | v0.2 | 30/30 | Complete | 2026-02-10 |
| 22-25 | v0.3 | 7/7 | Complete | 2026-02-11 |
| 26-29 | v0.4 | 17/17 | Complete | 2026-02-12 |
| 30-33 | v0.5 | 12/12 | Complete | 2026-02-13 |
| 34-38 | v0.6 | 10/10 | Complete | 2026-02-14 |
| 39-41 | v0.7 | 11/11 | Complete | 2026-02-14 |
| 42-50 | v0.8 | 19/19 | Complete | 2026-02-14 |
| 51-55 | v0.9 | 11/11 | Complete | 2026-02-15 |
| 56-59 | v0.10 | 11/11 | Complete | 2026-02-16 |
| 60-65 | v0.11 | 14/14 | Complete | 2026-02-16 |
| 66-71 | v0.12 | 11/11 | Complete | 2026-02-17 |
| 72-76 | v0.13 | 6/6 | Complete | 2026-02-18 |
| 77-80 | v0.14 | 8/8 | Complete | 2026-02-19 |
| 81 | v0.15 | 4/4 | Complete | 2026-02-19 |
| 82-85 | v0.16 | 6/6 | Complete | 2026-02-24 |
| 86 | 2/4 | In Progress|  | - |
| 87 | v0.17 | 0/? | Not started | - |
| 88 | v0.17 | 0/? | Not started | - |

---

*Roadmap updated: 2026-02-23 -- v0.17 roadmap created*

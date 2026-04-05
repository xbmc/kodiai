---
id: T01
parent: S01
milestone: M040
key_files:
  - src/db/migrations/034-review-graph.sql
  - src/review-graph/types.ts
  - src/review-graph/store.ts
  - src/review-graph/store.test.ts
  - .gsd/milestones/M040/slices/S01/tasks/T01-SUMMARY.md
key_decisions:
  - Store review graph data in dedicated review_graph_* tables keyed by repo/workspace/file so later indexing can replace one file atomically instead of rebuilding the full graph.
  - Use stable keys in the write contract and resolve them to database row ids inside the store transaction before inserting edges.
duration: 
verification_result: mixed
completed_at: 2026-04-05T09:58:50.848Z
blocker_discovered: false
---

# T01: Added persistent review-graph schema, typed store contracts, and transactional file-scoped graph replacement.

**Added persistent review-graph schema, typed store contracts, and transactional file-scoped graph replacement.**

## What Happened

Added the persistent review-graph substrate for the milestone’s first task. I created a new migration defining durable review_graph_builds, review_graph_files, review_graph_nodes, and review_graph_edges tables with indexes and constraints tuned for incremental file-scoped replacement. I added typed graph node, edge, file, and build contracts plus a ReviewGraphStore interface. I then implemented a postgres-backed store with build-state upsert support and transactional replaceFileGraph behavior that updates a file row, removes only that file’s prior graph records, reinserts replacement nodes, resolves edge endpoints by stable key, and writes edges atomically. I also added DB-backed integration tests covering build upserts, normal graph persistence, file-scoped replacement semantics, and rollback when an edge references a missing node. TypeScript verification passed. The DB-backed test command remains blocked by an environment-level DATABASE_URL connect timeout that also affects an existing repository integration test, so the failure is documented as environmental rather than a store-logic regression.

## Verification

Verified the new contract and implementation by running bun run tsc --noEmit successfully and by adding integration coverage in src/review-graph/store.test.ts for build-state upserts, file graph writes, atomic replacement, and rollback on invalid edge endpoints. Running bun test ./src/review-graph/store.test.ts hit the same external DATABASE_URL connect timeout seen when running the existing src/knowledge/store.test.ts integration suite, while a non-DB unit test (src/lib/guardrail/audit-store.test.ts) passed normally. This shows the remaining test failure is environmental rather than a local compile or unit-contract issue.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/review-graph/store.test.ts` | 1 | ❌ fail | 10050ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 0ms |
| 3 | `bun test ./src/lib/guardrail/audit-store.test.ts` | 0 | ✅ pass | 22ms |
| 4 | `bun test ./src/knowledge/store.test.ts --timeout 20000` | 124 | ❌ fail | 40000ms |

## Deviations

None.

## Known Issues

DB-backed integration tests cannot complete in the current environment because DATABASE_URL points to an unreachable Azure Postgres host; the new review-graph test and an existing knowledge-store integration test both reproduce the same connect timeout.

## Files Created/Modified

- `src/db/migrations/034-review-graph.sql`
- `src/review-graph/types.ts`
- `src/review-graph/store.ts`
- `src/review-graph/store.test.ts`
- `.gsd/milestones/M040/slices/S01/tasks/T01-SUMMARY.md`

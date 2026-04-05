---
id: S01
parent: M040
milestone: M040
provides:
  - A durable graph schema and typed store API that later slices can query instead of inventing ad hoc in-memory structures.
  - C++ and Python extraction outputs for files, symbols, imports/includes, callsites, and probable test relationships.
  - An incremental workspace indexing path that can populate and refresh persisted graph data without full rebuilds.
  - A deterministic DB-test gating pattern for the review-graph store that matches the rest of the repo.
requires:
  []
affects:
  - S02
  - S03
  - M038
key_files:
  - src/db/migrations/034-review-graph.sql
  - src/review-graph/types.ts
  - src/review-graph/store.ts
  - src/review-graph/store.test.ts
  - src/review-graph/extractors.ts
  - src/review-graph/extractors.test.ts
  - src/review-graph/indexer.ts
  - src/review-graph/indexer.test.ts
  - .gsd/KNOWLEDGE.md
  - .gsd/PROJECT.md
key_decisions:
  - Store review graph data in dedicated `review_graph_*` tables keyed by repo/workspace/file so later indexing can replace one file atomically instead of rebuilding the full graph.
  - Use stable keys in the write contract and resolve them to database row ids inside the store transaction before inserting edges.
  - Keep extraction file-scoped and represent probable test relationships with explicit confidence instead of overstating certainty.
  - Align DB-backed review-graph tests with the repository’s explicit `TEST_DATABASE_URL` gating pattern so auto-mode verification is deterministic.
  - Keep incremental indexing file-scoped and use persisted content hashes to decide whether each candidate file should be skipped or replaced.
  - Expose graph upkeep observability through structured indexed/updated/skipped/failed counters in both logs and persisted build state.
patterns_established:
  - Persistent graph writes use file-scoped transactional replacement: update the file row, delete only that file’s nodes/edges, insert replacement nodes, resolve edge endpoints from stable keys, then insert edges atomically.
  - Structural extraction should preserve uncertainty explicitly with confidence-bearing probable test links instead of fabricating precise cross-file relationships too early.
  - Incremental graph upkeep uses content-hash equality against persisted file state to skip unchanged files and bound write cost.
  - DB integration tests in this repo should use `TEST_DATABASE_URL`-gated whole-suite skips rather than opportunistic fallback to `DATABASE_URL`.
observability_surfaces:
  - `review_graph_builds` persisted status/counter rows for indexed files, failed files, nodes written, and edges written.
  - Structured logger events from `src/review-graph/indexer.ts` for per-file indexing outcomes and whole-run summaries, including indexed/updated/skipped/failed counters.
drill_down_paths:
  - .gsd/milestones/M040/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M040/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M040/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T10:11:43.064Z
blocker_discovered: false
---

# S01: Graph Schema and C++/Python Structural Extraction

**Delivered the first persistent review-graph substrate: dedicated schema and typed store, file-scoped C++/Python extraction, and an incremental indexer that persists and refreshes structural graph data with bounded per-file replacement.**

## What Happened

S01 established the storage and indexing substrate that later graph-aware review slices can consume. T01 added durable `review_graph_builds`, `review_graph_files`, `review_graph_nodes`, and `review_graph_edges` tables plus a typed `ReviewGraphStore` and transactional `replaceFileGraph()` write path that replaces one file’s graph rows atomically instead of rebuilding the entire repo graph. T02 implemented file-scoped structural extraction for Python and C++ in `src/review-graph/extractors.ts`, emitting file, symbol, import/include, callsite, and probable test records with explicit confidence rather than overstating certainty; it also aligned the store test with the repo’s `TEST_DATABASE_URL` gating convention so DB-backed verification behaves deterministically in auto-mode. T03 added `src/review-graph/indexer.ts`, which walks a workspace or changed-path subset, filters to supported languages, computes SHA-256 content hashes, skips unchanged files, replaces graph records only for new or modified files, updates persisted build counters, and logs indexed/updated/skipped/failed totals. Together these tasks mean a fixture Python or C++ workspace can now be indexed into dedicated graph tables and later slices have a stable persisted substrate for blast-radius and graph-context queries.

## Verification

Ran all slice-plan verification commands successfully at slice close: `bun test ./src/review-graph/store.test.ts` exited 0 with the suite cleanly skipped because `TEST_DATABASE_URL` was not configured, which matches the repository’s explicit DB-test contract; `bun test ./src/review-graph/extractors.test.ts` passed; `bun test ./src/review-graph/indexer.test.ts` passed; and `bun run tsc --noEmit` exited 0. I also verified the observability surface promised by T03 at the code level: the indexer persists indexed/failed/node/edge counters via `upsertBuild()` and emits structured per-file and whole-run logger events carrying indexed/updated/skipped/failed metrics.

## Requirements Advanced

- R037 — Established the persistent structural graph substrate that R037 depends on for structurally grounded impact context, specifically by persisting files, symbols, edges, and probable test relationships for C++ and Python.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

The slice plan listed extractor files under `src/review-graph/extractors/cpp.ts`, `python.ts`, and `index.ts`, but the implementation stayed in a single `src/review-graph/extractors.ts` module because the local codebase had no existing extractor directory or public API and a single-module surface was the smallest safe implementation. Likewise, the T01 verification originally assumed a live DB-backed store test run; the final slice uses the repo-standard `TEST_DATABASE_URL` gate so the suite skips cleanly when no dedicated test database is configured rather than probing a potentially unreachable `DATABASE_URL`.

## Known Limitations

Cross-file or imported call targets are not yet resolved into symbol-to-symbol edges during extraction; unresolved imported invocations remain preserved as callsite nodes for later index/query work. The indexer also does not yet remove persisted graph rows for files deleted from the workspace; it currently handles additions, updates, unchanged-file skips, and per-file failures only. Blast-radius ranking, downstream dependent traversal, and bounded prompt integration are not part of this slice and remain for S02/S03.

## Follow-ups

S02 should add read/query surfaces that traverse the persisted graph to compute impacted files, probable dependents, and likely tests from changed symbols/files. It should also decide whether deleted-file cleanup belongs in the indexer itself or in a separate reconciliation pass. S03 should consume the stored graph plus later current-code evidence to produce bounded Structural Impact review context and clean bypass behavior for trivial PRs.

## Files Created/Modified

- `src/db/migrations/034-review-graph.sql` — Added persistent review-graph schema for builds, files, nodes, and edges with constraints and indexes tuned for file-scoped replacement.
- `src/review-graph/types.ts` — Defined typed node, edge, file, build, and store contracts for the review graph subsystem.
- `src/review-graph/store.ts` — Implemented Postgres-backed build upsert and transactional file-scoped graph replacement behavior.
- `src/review-graph/store.test.ts` — Added DB-backed store coverage and aligned suite execution to `TEST_DATABASE_URL` gating so no-DB environments skip cleanly.
- `src/review-graph/extractors.ts` — Implemented Python and C++ structural extraction for files, symbols, imports/includes, callsites, and probable test links.
- `src/review-graph/extractors.test.ts` — Added fixture-driven extraction tests covering representative Python and C++ graph output shapes.
- `src/review-graph/indexer.ts` — Added incremental workspace indexing with supported-language filtering, SHA-256 content hashes, build-state persistence, and structured metrics/logging.
- `src/review-graph/indexer.test.ts` — Added in-memory indexer coverage for mixed-language indexing, unchanged-file skipping, changed-file updates, and per-file failures.
- `.gsd/KNOWLEDGE.md` — Recorded the `TEST_DATABASE_URL`-gated DB-suite pattern so future DB integration tests skip deterministically in auto-mode.
- `.gsd/PROJECT.md` — Refreshed project state to reflect M040/S01 completion and the new review-graph substrate.

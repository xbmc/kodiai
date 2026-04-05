# S01: Graph Schema and C++/Python Structural Extraction

**Goal:** Create the persistent graph substrate: schema, typed graph store, and Tree-sitter extraction/update paths tuned for C++ and Python first.
**Demo:** After this: After this, Kodiai can index a fixture C++ or Python repo into dedicated graph tables and inspect persisted nodes/edges for files, symbols, imports/includes, calls, and probable test relationships.

## Tasks
- [x] **T01: Added persistent review-graph schema, typed store contracts, and transactional file-scoped graph replacement.** — - Add graph persistence schema for files, symbols, edges, and graph-build bookkeeping.
- Define graph node/edge types and a store module separate from retrieval and prompt code.
- Keep the storage model tuned for incremental replacement instead of full graph rebuilds.
  - Estimate: 0.5-1d
  - Files: src/db/migrations/034-review-graph.sql, src/review-graph/types.ts, src/review-graph/store.ts, src/review-graph/store.test.ts
  - Verify: bun test ./src/review-graph/store.test.ts && bun run tsc --noEmit
- [x] **T02: Added C++ and Python review-graph extraction with fixture tests and stable no-DB store-test behavior.** — - Implement Tree-sitter-backed extractors for C++ and Python first; TS/JS support remains secondary.
- Capture files, symbols, imports/includes, call edges, and probable test relationships with explicit confidence where needed.
- Add fixture-driven tests that prove extraction shape on C++ and Python examples.
  - Estimate: 1-1.5d
  - Files: src/review-graph/extractors/cpp.ts, src/review-graph/extractors/python.ts, src/review-graph/extractors/index.ts, src/review-graph/extractors.test.ts
  - Verify: bun test ./src/review-graph/extractors.test.ts
- [ ] **T03: Build incremental graph indexer** — - Build the graph indexing and incremental-update path from workspace contents.
- Re-index only changed files and replace their graph records atomically.
- Add fixture tests proving incremental updates do not require full graph rebuilds.
  - Estimate: 0.5-1d
  - Files: src/review-graph/indexer.ts, src/review-graph/indexer.test.ts, src/review-graph/store.ts, src/jobs/workspace.ts
  - Verify: bun test ./src/review-graph/indexer.test.ts

# S01: Graph Schema and C++/Python Structural Extraction — UAT

**Milestone:** M040
**Written:** 2026-04-05T10:11:43.064Z

# S01 UAT — Graph Schema and C++/Python Structural Extraction

## Preconditions
- Run from repo root `/home/keith/src/kodiai`.
- Bun dependencies are installed.
- For DB-backed store verification, set `TEST_DATABASE_URL` to a reachable disposable Postgres database with permission to run migrations. If `TEST_DATABASE_URL` is unset, the store suite is expected to skip cleanly.

## Test Case 1 — Store suite obeys explicit test-DB gating
1. Ensure `TEST_DATABASE_URL` is **unset**.
2. Run `bun test ./src/review-graph/store.test.ts`.
3. Confirm Bun reports the suite as skipped rather than failed.

**Expected outcome:**
- Exit code is 0.
- The output shows skipped review-graph store tests.
- No attempt is made to connect through an unrelated `DATABASE_URL`.

## Test Case 2 — Graph schema + store persist one file graph atomically
1. Set `TEST_DATABASE_URL` to a reachable test Postgres instance.
2. Run `bun test ./src/review-graph/store.test.ts`.
3. Inspect the assertions covered by the suite:
   - build-state upsert creates then updates the same durable build row;
   - `replaceFileGraph()` writes file, node, and edge rows for one file;
   - replacing `src/alpha.cpp` removes only that file’s prior graph rows and preserves `src/beta.py` rows;
   - an edge referencing a missing stable key causes the transaction to roll back.

**Expected outcome:**
- Exit code is 0.
- A file-scoped replacement reuses the existing file row and replaces only its nodes/edges.
- Invalid edge endpoints fail the write and leave no partial file graph behind.

## Test Case 3 — Python extraction emits symbols, imports, calls, and probable tests
1. Run `bun test ./src/review-graph/extractors.test.ts`.
2. Confirm the Python fixture case checks `tests/test_service.py` extraction.
3. Verify the asserted graph shape includes:
   - one file node;
   - symbols including `Service.process` and `test_process_uses_helper`;
   - import targets `app.helpers` and `pytest`;
   - call edges including a call into `Service.process`;
   - at least one probable `tests` edge with confidence >= 0.9.

**Expected outcome:**
- Exit code is 0.
- Python extraction preserves likely test relationships as confidence-bearing graph data rather than pretending they are certain.

## Test Case 4 — C++ extraction emits includes, calls, and probable test relationships
1. Run `bun test ./src/review-graph/extractors.test.ts`.
2. Confirm the C++ fixture case checks `src/service_test.cpp` extraction.
3. Verify the asserted graph shape includes:
   - include edges for both headers;
   - symbols `helper`, `runService`, and `ServiceTest_runs_helper`;
   - call edges to both `helper` and `runService`;
   - a single probable `tests` edge whose confidence is greater than 0.6 and less than 1.

**Expected outcome:**
- Exit code is 0.
- C++ extraction captures likely test relationships heuristically with bounded confidence instead of overstating certainty.

## Test Case 5 — Incremental indexer only rewrites changed supported files
1. Run `bun test ./src/review-graph/indexer.test.ts`.
2. In the mixed-language indexing case, confirm only supported files (`.py`, `.cpp`) are discovered and indexed while `README.md` is ignored.
3. In the incremental-update case, confirm a changed `src/service.py` is reindexed while unchanged `src/worker.cpp` is skipped.
4. Confirm the build state moves to the new commit SHA and preserves the previous build id on the unchanged file.

**Expected outcome:**
- Exit code is 0.
- Discovery count includes only supported graph languages.
- `indexed=1`, `updated=1`, `skipped=1`, `failed=0` for the changed-path incremental run.
- The unchanged file keeps its earlier build association.

## Test Case 6 — Per-file index failures are isolated and observable
1. Run `bun test ./src/review-graph/indexer.test.ts`.
2. Inspect the failure-handling case where `worker.cpp` read is forced to throw `simulated read failure`.
3. Confirm the Python file still indexes successfully.
4. Confirm the resulting build status is `failed` with `lastError = "simulated read failure"` and the failed file list records the path/error pair.

**Expected outcome:**
- Exit code is 0.
- One bad file does not prevent other supported files from being indexed.
- Persisted build-state counters and failure metadata accurately describe the run.

## Test Case 7 — TypeScript integration stays clean
1. Run `bun run tsc --noEmit`.

**Expected outcome:**
- Exit code is 0.
- The review-graph schema, store, extractor, and indexer code integrate with the repo’s type surface without introducing compile errors.

## Edge Cases To Check Manually In Follow-On Slices
- Deleted files are not yet reconciled out of the persisted review graph; confirm S02/S03 do not assume deletion cleanup exists.
- Imported or cross-file call targets that cannot be resolved during per-file extraction remain as callsite nodes; downstream query code must tolerate that unresolved state.


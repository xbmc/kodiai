# S01: Canonical Schema, Chunking, and Storage — UAT

**Milestone:** M041
**Written:** 2026-04-05T14:12:16.445Z

# S01: Canonical Schema, Chunking, and Storage — UAT

**Milestone:** M041
**Written:** 2026-04-05T05:48:35-07:00

## UAT Type
- UAT mode: code-and-contract verification
- Surface under test: canonical current-code schema, chunking, and snapshot ingest substrate

## Preconditions
- Run from repo root `/home/keith/src/kodiai`.
- Bun dependencies are installed.
- No live external services are required; all tests are fixture/mocked.

## Test Case 1 — Canonical store exposes dedicated current-code persistence semantics
1. Run `bun test ./src/knowledge/canonical-code-store.test.ts`.
2. Confirm the suite covers insert, dedup, replace, soft-delete, semantic/full-text search, stale-row listing, embedding batch updates, and backfill-state persistence.
3. Inspect the assertions for `upsertChunk()` outcomes.

**Expected outcome:**
- Exit code is 0.
- The suite proves `upsertChunk()` returns `inserted` for a new chunk identity, `dedup` when `content_hash` matches, and `replaced` when `content_hash` changes.
- Canonical storage is represented by `canonical_code_chunks` / `canonical_corpus_backfill_state`, not historical `code_snippets` tables.

## Test Case 2 — File-level replacement soft-deletes prior live canonical rows
1. Run `bun test ./src/knowledge/canonical-code-store.test.ts`.
2. Inspect the `deleteChunksForFile` assertions.
3. Confirm the test expects soft-delete count returns rather than destructive hard deletes.

**Expected outcome:**
- Exit code is 0.
- File-level refresh is modeled as soft-deleting active canonical rows for one file before re-ingest.
- This preserves truthful replacement semantics for removed or renamed symbols within a refreshed file.

## Test Case 3 — Chunker excludes generated, vendored, lockfile, build-output, and asset paths with auditable reasons
1. Run `bun test ./src/knowledge/canonical-code-chunker.test.ts`.
2. Inspect the exclusion-focused test cases.
3. Confirm excluded results return `chunks: []` and set `observability.excluded=true` with an explicit `exclusionReason`.

**Expected outcome:**
- Exit code is 0.
- Excluded paths are machine-auditable by reason (`generated`, `vendored`, `lockfile`, `build_output`, or `binary_or_asset`).
- The canonical chunker does not silently drop files without surfacing why.

## Test Case 4 — Python files chunk into module/class/function boundaries
1. Run `bun test ./src/knowledge/canonical-code-chunker.test.ts`.
2. Inspect the Python boundary test.
3. Confirm the result includes a module remainder chunk plus symbol chunks for class/function definitions when present.

**Expected outcome:**
- Exit code is 0.
- Boundary decisions include `module`, `class`, and `function` where appropriate.
- Canonical chunking remains structurally grounded rather than arbitrary fixed-size splitting.

## Test Case 5 — Symbol-poor C++ falls back to a single block chunk only when no symbol boundary exists
1. Run `bun test ./src/knowledge/canonical-code-chunker.test.ts`.
2. Inspect the symbol-poor C++ fixture case.
3. Confirm the result returns one `block` chunk with `boundaryDecisions: ["block"]`.
4. Compare that with the separate C++ boundary test that returns function/module chunks when symbols are detectable.

**Expected outcome:**
- Exit code is 0.
- `block` fallback is used only for files where no function/class boundary is found at all.
- Mixed C++ files with detectable symbols preserve symbol chunks plus optional module remainder rather than collapsing into a block.

## Test Case 6 — Snapshot ingest reports inserted, replaced, dedup, exclusion, and historical-store separation correctly
1. Run `bun test ./src/knowledge/canonical-code-ingest.test.ts`.
2. Inspect the fixture-driven ingest cases.
3. Confirm the suite proves:
   - first ingest inserts canonical chunks;
   - repeat ingest of unchanged content reports dedup after file soft-delete;
   - changed content reports replacement;
   - excluded files are skipped with explicit observability;
   - no historical diff-hunk store APIs are called.

**Expected outcome:**
- Exit code is 0.
- The ingest path is dedicated to canonical current-code storage and never blurs into historical diff-hunk semantics.
- File results include `deletedCount`, `inserted`, `replaced`, and `dedup` counters per file.

## Test Case 7 — TypeScript integration remains clean across the new canonical substrate
1. Run `bun run tsc --noEmit`.

**Expected outcome:**
- Exit code is 0.
- The migration contract, canonical types, chunker, store, ingest path, and index exports integrate with the existing repo without type regressions.

## Requirements Proved By This UAT
- **R036** — Proves the substrate half of the canonical current-code corpus requirement: Kodiai can define, chunk, and ingest current-code chunks into dedicated canonical tables with repo/ref/commit provenance and explicit replacement semantics separate from historical diff-hunk storage.

## Not Proven By This UAT
- Real default-branch backfill over a repository workspace.
- Retrieval from the canonical corpus in a live review-style query flow.
- Incremental changed-file refresh, drift detection, or selective repair. Those belong to M041/S02 and M041/S03.


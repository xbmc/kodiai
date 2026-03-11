---
id: S04
parent: M019
milestone: M019
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 
blocker_discovered: false
---
# S04: Code Snippet Embedding

**# Plan 96-02 Summary: TDD Diff Hunk Parser**

## What Happened

# Plan 96-02 Summary: TDD Diff Hunk Parser

**Status:** Complete
**Duration:** ~5 min

## What was built
- `parseDiffHunks()` — extracts hunks from unified diff, filters by min changed lines
- `buildEmbeddingText()` — assembles semantic embedding text (PR title | file | fn context + added lines)
- `isExcludedPath()` — glob-based file exclusion using picomatch
- `applyHunkCap()` — bounds per-PR hunk count, keeping largest hunks
- `computeContentHash()` — SHA-256 deterministic hashing for dedup

## Key files
- `src/knowledge/code-snippet-chunker.ts` — all 5 functions
- `src/knowledge/code-snippet-chunker.test.ts` — 28 tests, all passing

## Self-Check: PASSED
- [x] 28/28 tests pass
- [x] Pure-deletion hunks excluded
- [x] Min changed lines filter works
- [x] Hunk cap keeps largest by line count
- [x] Content hash is deterministic SHA-256 (64-char hex)
- [x] Language classified from file path

# Plan 96-04 Summary: Pipeline Integration + Review Handler

**Status:** Complete
**Duration:** ~10 min

## What was built

### Task 1: Retrieval pipeline integration
- `snippetToUnified()` normalizer produces `[snippet] PR #N: title -- file:start-end` labels
- 7th search added to `Promise.allSettled` fan-out (snippet vector search)
- Within-corpus dedup applied to snippet results before cross-corpus RRF
- `SOURCE_WEIGHTS` updated: snippet gets 1.1 for pr_review, 0.8 for issue/question, 1.0 for slack
- `getChunkLanguage` handles snippet source via metadata.language
- Provenance includes `snippetCount`
- `codeSnippetStore` is optional dep on createRetriever (backward compatible)

### Task 2: Review handler + application bootstrap
- `embedDiffHunks()` async function with fail-open semantics
- `splitDiffByFile()` helper splits multi-file unified diff into per-file segments
- Fire-and-forget call after review completion (alongside learning memory write)
- Respects `config.knowledge.retrieval.hunkEmbedding.enabled` flag
- Applies `isExcludedPath`, `applyHunkCap`, `minChangedLines` before embedding
- `index.ts` creates `createCodeSnippetStore`, passes to `createRetriever` and `createReviewHandler`

## Key files
- `src/knowledge/retrieval.ts` -- snippet corpus in RRF pipeline
- `src/knowledge/index.ts` -- re-exports for all snippet modules
- `src/handlers/review.ts` -- embedDiffHunks trigger + splitDiffByFile
- `src/index.ts` -- CodeSnippetStore creation and DI wiring

## Self-Check: PASSED
- [x] createRetriever accepts optional codeSnippetStore (backward compat)
- [x] Snippet corpus participates in cross-corpus RRF as 4th source list
- [x] snippetToUnified produces [snippet] labels with PR# + file + line range
- [x] Review handler triggers hunk embedding async after completion
- [x] Hunk embedding respects enabled flag, excludePatterns, maxHunksPerPr
- [x] Fire-and-forget with .catch() for unhandled rejection safety
- [x] All 72 review handler tests pass (zero regressions)
- [x] All 79 config tests pass
- [x] All 37 snippet tests pass (chunker: 28, retrieval: 5, store: 4)

# Plan 96-03 Summary: Store + Retrieval

**Status:** Complete
**Duration:** ~5 min

## What was built
- `createCodeSnippetStore()` — PostgreSQL store with pgvector for code snippets
  - `writeSnippet()` uses UPSERT (ON CONFLICT content_hash DO NOTHING) for dedup
  - `writeOccurrence()` creates junction table entries
  - `searchByEmbedding()` with LATERAL JOIN for best occurrence metadata
  - `searchByFullText()` using tsvector BM25
- `searchCodeSnippets()` — fail-open retrieval search (returns [] on any error)

## Key files
- `src/knowledge/code-snippet-store.ts` — store implementation
- `src/knowledge/code-snippet-store.test.ts` — 4 tests
- `src/knowledge/code-snippet-retrieval.ts` — retrieval search
- `src/knowledge/code-snippet-retrieval.test.ts` — 5 tests

## Self-Check: PASSED
- [x] writeSnippet uses ON CONFLICT DO NOTHING for dedup (SNIP-03)
- [x] searchByEmbedding uses pgvector cosine distance with LATERAL JOIN
- [x] Retrieval is fail-open end-to-end
- [x] All 9 tests pass

# Plan 96-01 Summary: Foundation — Types, Migration, Config

**Status:** Complete
**Duration:** ~5 min

## What was built
- `CodeSnippetStore` interface, `CodeSnippetRecord`, `CodeSnippetOccurrence`, `CodeSnippetSearchResult` types
- Migration 009: `code_snippets` table with content_hash UNIQUE, vector(1024), HNSW index, tsvector
- Migration 009: `code_snippet_occurrences` junction table linking content_hash to PR/file/line
- Extended `SourceType` union with `"snippet"`
- Added `hunkEmbedding` config schema (enabled, maxHunksPerPr, minChangedLines, excludePatterns)

## Key files
- `src/knowledge/code-snippet-types.ts` — all types
- `src/db/migrations/009-code-snippets.sql` — schema
- `src/db/migrations/009-code-snippets.down.sql` — rollback
- `src/knowledge/cross-corpus-rrf.ts` — SourceType extended
- `src/execution/config.ts` — hunkEmbedding schema
- `src/execution/config.test.ts` — 2 new tests (81 total pass)

## Self-Check: PASSED
- [x] Types compile
- [x] SourceType accepts "snippet"
- [x] Config tests pass (79 → 81 tests)
- [x] Migration SQL valid

---
status: complete
phase: 96-code-snippet-embedding
source: 96-01-SUMMARY.md, 96-02-SUMMARY.md, 96-03-SUMMARY.md, 96-04-SUMMARY.md
started: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Database migration applies cleanly
expected: Migration 009 creates code_snippets table (content_hash UNIQUE, vector(1024), HNSW index, tsvector) and code_snippet_occurrences junction table with proper indexes and FK.
result: pass

### 2. Config accepts hunkEmbedding settings
expected: Config schema validates hunkEmbedding block with enabled (boolean), maxHunksPerPr (number 1-1000), minChangedLines (number 1-50), excludePatterns (string array). Sensible defaults applied.
result: pass

### 3. All unit tests pass
expected: Full test suite passes with zero regressions. 1494 tests across 90 files.
result: pass

### 4. Diff hunk parsing extracts meaningful snippets
expected: parseDiffHunks extracts added-line hunks, filters pure-deletion hunks, respects minChangedLines, isExcludedPath skips matching globs, applyHunkCap keeps largest hunks.
result: pass

### 5. Snippet deduplication works
expected: writeSnippet uses ON CONFLICT (content_hash) DO NOTHING — same content produces one row. Occurrences link via junction table. computeContentHash is deterministic SHA-256.
result: pass

### 6. Snippet retrieval appears in cross-corpus search results
expected: snippetToUnified produces [snippet] PR #N: title -- file:start-end labels. Snippet corpus is 7th search in Promise.allSettled fan-out with SOURCE_WEIGHTS config. Within-corpus dedup applied before RRF.
result: pass

### 7. Review handler triggers hunk embedding after review
expected: embedDiffHunks fires async after review completion (fire-and-forget with .catch()). Respects hunkEmbedding.enabled flag, excludePatterns, maxHunksPerPr. splitDiffByFile splits multi-file diff into per-file segments.
result: pass

### 8. Application bootstraps with snippet store wired
expected: index.ts creates CodeSnippetStore and passes to createRetriever and createReviewHandler. Store is optional parameter (backward compatible).
result: pass

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]

---
id: T02
parent: S04
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
# T02: 96-code-snippet-embedding 02

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

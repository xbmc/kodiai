---
id: T03
parent: S01
milestone: M040
key_files:
  - src/review-graph/indexer.ts
  - src/review-graph/indexer.test.ts
  - .gsd/milestones/M040/slices/S01/tasks/T03-SUMMARY.md
key_decisions:
  - Keep incremental indexing file-scoped and use persisted content hashes to decide whether each candidate file should be skipped or replaced.
  - Expose graph upkeep observability through structured indexed/updated/skipped/failed counters in both logs and review_graph_build state.
duration: 
verification_result: passed
completed_at: 2026-04-05T10:09:04.012Z
blocker_discovered: false
---

# T03: Added an incremental review-graph indexer that walks workspaces, skips unchanged files by content hash, and records indexed/updated/skipped counts with fixture coverage.

**Added an incremental review-graph indexer that walks workspaces, skips unchanged files by content hash, and records indexed/updated/skipped counts with fixture coverage.**

## What Happened

Added src/review-graph/indexer.ts as the workspace-level entrypoint for review-graph upkeep. The indexer walks a workspace deterministically when no changed-path list is provided, narrows to supported Python and C++ files, computes SHA-256 content hashes, checks persisted file state, skips unchanged files, and replaces graph records only for new or modified files. It also upserts review graph build state before and after the run, aggregates discovered/indexed/updated/skipped/failed plus node and edge totals, and emits structured logger events for per-file and whole-run observability. Added src/review-graph/indexer.test.ts with an in-memory ReviewGraphStore to prove mixed-language indexing, changed-file incremental behavior, unchanged-file skipping, and per-file failure handling without requiring a live database. A single failing assertion during verification was due to deterministic lexical ordering of discovered paths; I corrected the test expectation to match the implementation rather than changing runtime behavior.

## Verification

Ran bun test ./src/review-graph/indexer.test.ts successfully, covering supported-language discovery, incremental changed-file updates, unchanged-file skipping, and per-file failure handling. Ran bun run tsc --noEmit successfully to confirm the new indexer integrates cleanly with the repository type surface.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/review-graph/indexer.test.ts` | 0 | ✅ pass | 28ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 0ms |

## Deviations

Used the existing src/review-graph/extractors.ts module instead of the planned src/review-graph/extractors/index.ts path because the local codebase still exposes extraction through the single-module surface.

## Known Issues

The indexer does not yet remove persisted graph rows for files deleted from the workspace; it currently handles additions, updates, skips, and per-file failures only.

## Files Created/Modified

- `src/review-graph/indexer.ts`
- `src/review-graph/indexer.test.ts`
- `.gsd/milestones/M040/slices/S01/tasks/T03-SUMMARY.md`

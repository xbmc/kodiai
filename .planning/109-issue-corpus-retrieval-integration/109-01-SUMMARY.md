---
phase: 109-issue-corpus-retrieval-integration
plan: 01
subsystem: knowledge/retrieval
tags: [issue-corpus, hybrid-search, retrieval-pipeline, rrf]
dependency_graph:
  requires: [issue-store, issue-types, hybrid-search, cross-corpus-rrf]
  provides: [issue-retrieval, unified-issue-search]
  affects: [retrieval, cross-corpus-rrf, index]
tech_stack:
  added: []
  patterns: [hybrid-vector-bm25, rrf-fusion, fail-open-search]
key_files:
  created:
    - src/knowledge/issue-retrieval.ts
  modified:
    - src/knowledge/cross-corpus-rrf.ts
    - src/knowledge/retrieval.ts
    - src/knowledge/index.ts
    - src/index.ts
decisions:
  - "Issue weights locked: pr_review=0.8, issue=1.5, question=1.2, slack=1.0"
  - "Citation format: [issue: #N] Title (status) with GitHub URL"
  - "BM25 normalization uses record extraction pattern matching wiki/review approach"
metrics:
  duration: 213s
  completed: "2026-02-27T19:11:10Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
requirements: [PRLINK-04]
---

# Phase 109 Plan 01: Wire Issue Corpus into Unified Cross-Corpus Retrieval Pipeline Summary

Issue hybrid search (vector + BM25) wired into unified retrieval pipeline with per-trigger source weights and [issue: #N] Title (status) citations.

## What Was Done

### Task 1: Create issue-retrieval.ts search module and extend SourceType

Created `src/knowledge/issue-retrieval.ts` following the wiki-retrieval.ts pattern:
- `IssueKnowledgeMatch` type with chunkText, distance, repo, issueNumber, title, state, authorLogin, githubCreatedAt, source fields
- `searchIssues()` function: generates query embedding, calls store.searchByEmbedding(), filters by distance threshold (0.7), maps to IssueKnowledgeMatch
- Fail-open: returns empty array if embedding generation returns null

Extended `SourceType` in cross-corpus-rrf.ts to include `"issue"` in the union type.

Added re-exports of `searchIssues` and `IssueKnowledgeMatch` to knowledge/index.ts.

### Task 2: Wire issue search into retrieval pipeline and application bootstrap

In `src/knowledge/retrieval.ts`:
- Added imports for searchIssues, IssueKnowledgeMatch, and IssueStore
- Added `issue` key to all four SOURCE_WEIGHTS trigger entries with locked values
- Added `issueMatchToUnified()` normalizer producing `[issue: #N] Title (status)` sourceLabel and GitHub issue URLs
- Added `issueStore?: IssueStore` to createRetriever deps
- Added issue vector search (slot h) and issue BM25 full-text search (slot i) to Promise.allSettled fan-out
- Added issue result extraction with fail-open logging
- Added issue BM25 normalization via record extraction pattern
- Added hybridSearchMerge for issue vector + BM25 results
- Added within-corpus dedup for issues
- Added issue sourceLists entry for cross-corpus RRF
- Added `issueCount` to provenance type and return value

In `src/index.ts`:
- Added `issueStore` to the createRetriever() call

## Verification Results

1. TypeScript compiles cleanly (no new errors; pre-existing test file errors unrelated)
2. SourceType includes "issue" -- confirmed
3. SOURCE_WEIGHTS has issue entries for all four triggers -- confirmed
4. issueStore in createRetriever deps -- confirmed
5. issueStore wired in index.ts -- confirmed
6. Citation format `[issue: #N]` -- confirmed
7. Re-exports of searchIssues in knowledge/index.ts -- confirmed

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 76b48f45bd | feat(109-01): wire issue corpus into unified cross-corpus retrieval pipeline |

## Self-Check: PASSED

- [x] src/knowledge/issue-retrieval.ts exists
- [x] Commit 76b48f45bd exists in git log
- [x] All 7 verification grep checks pass
- [x] No new TypeScript compilation errors introduced

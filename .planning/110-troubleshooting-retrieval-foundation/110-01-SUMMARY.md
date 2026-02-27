---
phase: 110-troubleshooting-retrieval-foundation
plan: 01
status: complete
---

## What was done

Extended IssueStore with state-filtered search, built a resolution-focused thread assembler, and created the troubleshooting retrieval orchestrator with wiki fallback and silent no-match.

### Changes

1. **`src/knowledge/issue-types.ts`** — Added optional `stateFilter?: string` to `searchByEmbedding` and `searchByFullText` method signatures on the `IssueStore` interface.

2. **`src/knowledge/issue-store.ts`** — Added conditional `AND state = $stateFilter` SQL WHERE clauses to both `searchByEmbedding` and `searchByFullText` implementations.

3. **`src/knowledge/issue-retrieval.ts`** — Added `stateFilter?: string` to `searchIssues` opts and passes it through to `store.searchByEmbedding()`.

4. **`src/execution/config.ts`** — Added `troubleshooting` sub-object to `triageSchema` with `enabled`, `similarityThreshold`, `maxResults`, and `totalBudgetChars` fields with defaults.

5. **`src/knowledge/thread-assembler.ts`** (new) — Exports:
   - `truncateIssueBody()` — First/last paragraph truncation for long bodies
   - `selectTailComments()` — Tail-first comment selection within budget
   - `computeBudgetDistribution()` — Similarity-weighted budget allocation
   - `assembleIssueThread()` — Full thread assembly with tail + semantic fill
   - `ThreadAssemblyResult` type

6. **`src/knowledge/troubleshooting-retrieval.ts`** (new) — Exports:
   - `retrieveTroubleshootingContext()` — Hybrid search (vector + BM25) for closed issues, similarity floor, PR filter, budget-weighted thread assembly, dual-query wiki fallback, silent no-match
   - `extractKeywords()` — Heuristic keyword extraction for wiki fallback
   - `TroubleshootingResult`, `TroubleshootingConfig`, `TroubleshootingMatch` types

7. **`src/knowledge/index.ts`** — Re-exports all new thread-assembler and troubleshooting-retrieval types and functions.

### Verification

- `bun build` clean on all modified/new files
- Existing `issue-store.test.ts` (15 tests) still passes
- All 456 knowledge tests pass

# S04: Issue Corpus Retrieval Integration

**Goal:** Wire the issue corpus into the unified cross-corpus retrieval pipeline so that PR reviews, @mention responses, and Slack queries can find and cite related issues via hybrid (vector + BM25) search.
**Demo:** Wire the issue corpus into the unified cross-corpus retrieval pipeline so that PR reviews, @mention responses, and Slack queries can find and cite related issues via hybrid (vector + BM25) search.

## Must-Haves


## Tasks

- [x] **T01: 109-issue-corpus-retrieval-integration 01**
  - Wire the issue corpus into the unified cross-corpus retrieval pipeline so that PR reviews, @mention responses, and Slack queries can find and cite related issues via hybrid (vector + BM25) search.

Purpose: Issues are already ingested (phase 106) and linked to PRs (phase 108). This plan makes issue knowledge discoverable through the same retrieval pipeline all other corpora use, completing the issue intelligence story.

Output: Issue results appear in unified retrieval alongside code, review comments, wiki pages, and snippets -- with `[issue: #N] Title (status)` citations and per-trigger weight tuning.

## Files Likely Touched

- `src/knowledge/issue-retrieval.ts`
- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/index.ts`
- `src/index.ts`

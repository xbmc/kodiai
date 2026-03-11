# T01: 109-issue-corpus-retrieval-integration 01

**Slice:** S04 — **Milestone:** M022

## Description

Wire the issue corpus into the unified cross-corpus retrieval pipeline so that PR reviews, @mention responses, and Slack queries can find and cite related issues via hybrid (vector + BM25) search.

Purpose: Issues are already ingested (phase 106) and linked to PRs (phase 108). This plan makes issue knowledge discoverable through the same retrieval pipeline all other corpora use, completing the issue intelligence story.

Output: Issue results appear in unified retrieval alongside code, review comments, wiki pages, and snippets -- with `[issue: #N] Title (status)` citations and per-trigger weight tuning.

## Must-Haves

- [ ] "Issue results appear alongside code, review_comment, wiki, and snippet results in unified RRF retrieval"
- [ ] "Issue citations use [issue: #N] Title (status) format in sourceLabel"
- [ ] "Issue corpus is weighted per trigger type: pr_review=0.8, issue=1.5, question=1.2, slack=1.0"
- [ ] "Both vector and BM25 search are used for issues (hybrid search)"
- [ ] "Missing issueStore does not break the retrieval pipeline (fail-open)"

## Files

- `src/knowledge/issue-retrieval.ts`
- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/index.ts`
- `src/index.ts`

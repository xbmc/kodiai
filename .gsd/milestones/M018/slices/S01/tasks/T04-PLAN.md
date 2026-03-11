# T04: 89-pr-review-comment-ingestion 04

**Slice:** S01 — **Milestone:** M018

## Description

Wire the review comment corpus into the existing retrieval pipeline and add inline citation formatting so the bot can cite human review precedents in its responses.

Purpose: Make 18 months of human review patterns actionable — the bot should surface "reviewers have historically flagged this pattern" evidence when reviewing new PRs.
Output: Updated retrieval pipeline with review comment fan-out, and prompt builder with citation formatting.

## Must-Haves

- [ ] "Review comment corpus is searchable via the existing createRetriever() pipeline"
- [ ] "Retrieval results from review comments include source attribution metadata (PR number, author, file)"
- [ ] "Bot cites human review precedents inline with format: reviewers have previously flagged this pattern (PR #1234, @author)"
- [ ] "Only strong matches are cited — low-similarity results are silently dropped"
- [ ] "Review comment retrieval is fail-open: errors degrade gracefully without blocking review"

## Files

- `src/knowledge/retrieval.ts`
- `src/knowledge/retrieval.test.ts`
- `src/knowledge/review-comment-retrieval.ts`
- `src/knowledge/review-comment-retrieval.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/knowledge/index.ts`
- `src/index.ts`
- `src/handlers/review.ts`

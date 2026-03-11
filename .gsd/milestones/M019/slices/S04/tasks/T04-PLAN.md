# T04: 96-code-snippet-embedding 04

**Slice:** S04 — **Milestone:** M019

## Description

Wire code snippets into the cross-corpus retrieval pipeline and trigger hunk embedding from the review handler.

Purpose: Complete the end-to-end integration — hunks are embedded after review and appear in retrieval results.
Output: Fourth corpus in RRF pipeline, async embedding trigger in review handler.

## Must-Haves

- [ ] createRetriever accepts optional codeSnippetStore dependency
- [ ] Snippet corpus participates in cross-corpus RRF as a fourth source list
- [ ] snippetToUnified normalizer produces [snippet] source labels with PR title + file + line range
- [ ] Review handler triggers hunk embedding asynchronously after review completion
- [ ] Hunk embedding respects retrieval.hunkEmbedding.enabled flag
- [ ] Hunk embedding applies excludePatterns and maxHunksPerPr cap before calling embedding API
- [ ] The entire embedding pipeline is fire-and-forget with fail-open error handling

## Files

- `src/knowledge/retrieval.ts`
- `src/knowledge/index.ts`
- `src/handlers/review.ts`
- `src/index.ts`
- `src/knowledge/retrieval.test.ts`

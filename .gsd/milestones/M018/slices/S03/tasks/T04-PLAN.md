# T04: 91-cross-corpus-retrieval-integration 04

**Slice:** S03 — **Milestone:** M018

## Description

Wire all retrieval consumers to use unified results with cross-corpus attribution formatting, and create the end-to-end validation test.

Purpose: Complete the consumer side of the unified retrieval layer. All handlers (review, mention, Slack) must use the new `unifiedResults` and `contextWindow` from the retriever. Citation formatting should use the inline source labels specified in CONTEXT.md. The E2E test validates that a single retrieval call returns results from all three corpora with proper attribution.

Output: All consumers use unified retrieval. End-to-end test proves the full pipeline.

## Must-Haves

- [ ] "PR review responses cite code context, human review precedent, and wiki pages in one response"
- [ ] "Every citation is a clickable markdown link to the source"
- [ ] "No retrieval path bypasses the unified layer"
- [ ] "End-to-end test validates cross-corpus retrieval with attribution"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/slack/assistant-handler.ts`
- `src/knowledge/retrieval.e2e.test.ts`

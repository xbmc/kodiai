# T03: 59-resilience-layer 03

**Slice:** S04 — **Milestone:** M010

## Description

Wire checkpoint accumulation, partial review publishing, retry with scope reduction, and chronic timeout detection into the review execution pipeline.

Purpose: This is the integration plan that makes timeout resilience work end-to-end: the checkpoint MCP tool is conditionally provided to the executor, the review handler publishes partial results on timeout, retries with reduced scope when eligible, and skips retry for chronic timeout repo+author pairs.
Output: Modified review handler with complete timeout resilience path, MCP builder with conditional checkpoint server, review prompt with checkpoint instruction.

## Must-Haves

- [ ] "On timeout with checkpoint data having at least 1 finding, Kodiai publishes a partial review comment with disclaimer instead of a generic error"
- [ ] "After publishing a partial review, Kodiai enqueues a retry job with reduced file scope focused on unreviewed files and halved timeout"
- [ ] "When repo+author has 3+ recent timeouts, retry is skipped and the partial review explains why with splitting guidance"
- [ ] "Retry result replaces the partial review comment via edit, producing a merged view of all analyzed files"
- [ ] "Retry is capped at exactly 1 attempt -- no second retry regardless of outcome"
- [ ] "Checkpoint MCP tool is only provided when timeout risk is medium or high"
- [ ] "pr_author is recorded in telemetry for every review execution"

## Files

- `src/execution/mcp/index.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`

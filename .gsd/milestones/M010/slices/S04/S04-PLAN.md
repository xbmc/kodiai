# S04: Resilience Layer

**Goal:** Build the checkpoint accumulation infrastructure: a knowledge store table for persisting checkpoint data, and an MCP tool that Claude invokes during review execution to report progress.
**Demo:** Build the checkpoint accumulation infrastructure: a knowledge store table for persisting checkpoint data, and an MCP tool that Claude invokes during review execution to report progress.

## Must-Haves


## Tasks

- [x] **T01: 59-resilience-layer 01** `est:2min`
  - Build the checkpoint accumulation infrastructure: a knowledge store table for persisting checkpoint data, and an MCP tool that Claude invokes during review execution to report progress.

Purpose: Enables the review handler to know what was reviewed and what findings exist when a timeout occurs, which is the prerequisite for partial review publishing and retry scope reduction.
Output: `createCheckpointServer` factory function, `review_checkpoints` table, checkpoint CRUD methods on KnowledgeStore.
- [x] **T02: 59-resilience-layer 02** `est:1min`
  - Build the pure-function modules for partial review formatting and retry scope reduction, plus add chronic timeout detection to the telemetry store.

Purpose: These are the building blocks the review handler needs to publish partial reviews with appropriate disclaimers, compute which files to retry, and decide whether retry should be skipped for chronically timing-out repo+author pairs.
Output: `formatPartialReviewComment`, `computeRetryScope` functions with full test coverage, `countRecentTimeouts` telemetry method with `pr_author` column migration.
- [x] **T03: 59-resilience-layer 03** `est:9min`
  - Wire checkpoint accumulation, partial review publishing, retry with scope reduction, and chronic timeout detection into the review execution pipeline.

Purpose: This is the integration plan that makes timeout resilience work end-to-end: the checkpoint MCP tool is conditionally provided to the executor, the review handler publishes partial results on timeout, retries with reduced scope when eligible, and skips retry for chronic timeout repo+author pairs.
Output: Modified review handler with complete timeout resilience path, MCP builder with conditional checkpoint server, review prompt with checkpoint instruction.

## Files Likely Touched

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/execution/mcp/checkpoint-server.ts`
- `src/execution/mcp/checkpoint-server.test.ts`
- `src/lib/partial-review-formatter.ts`
- `src/lib/partial-review-formatter.test.ts`
- `src/lib/retry-scope-reducer.ts`
- `src/lib/retry-scope-reducer.test.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/execution/mcp/index.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`

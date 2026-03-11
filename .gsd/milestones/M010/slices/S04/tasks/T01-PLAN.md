# T01: 59-resilience-layer 01

**Slice:** S04 — **Milestone:** M010

## Description

Build the checkpoint accumulation infrastructure: a knowledge store table for persisting checkpoint data, and an MCP tool that Claude invokes during review execution to report progress.

Purpose: Enables the review handler to know what was reviewed and what findings exist when a timeout occurs, which is the prerequisite for partial review publishing and retry scope reduction.
Output: `createCheckpointServer` factory function, `review_checkpoints` table, checkpoint CRUD methods on KnowledgeStore.

## Must-Haves

- [ ] "Checkpoint MCP tool accepts filesReviewed, findingCount, summaryDraft and persists to knowledge store"
- [ ] "Knowledge store can save, retrieve, update, and delete checkpoint records keyed by reviewOutputKey"
- [ ] "Checkpoint supports upsert semantics so repeated calls overwrite previous checkpoint for the same reviewOutputKey"

## Files

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/execution/mcp/checkpoint-server.ts`
- `src/execution/mcp/checkpoint-server.test.ts`

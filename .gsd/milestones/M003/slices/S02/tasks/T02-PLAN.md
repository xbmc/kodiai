# T02: 23-telemetry-foundation 02

**Slice:** S02 — **Milestone:** M003

## Description

Enrich ExecutionResult with per-model token data (inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens), model name, and stopReason extracted from the Claude Agent SDK's SDKResultMessage.

Purpose: TELEM-01 requires ExecutionResult to include full SDK data so handlers can pass it to the telemetry store. This plan adds the fields and extraction logic without changing any handler code.
Output: Updated ExecutionResult type and executor that populates the new fields.

## Must-Haves

- [ ] "ExecutionResult includes model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, and stopReason fields"
- [ ] "On successful execution, token counts are summed from SDKResultMessage.modelUsage across all model entries"
- [ ] "On error/timeout execution, token fields are undefined and model falls back to 'unknown'"
- [ ] "Existing handler code that reads ExecutionResult (conclusion, costUsd, published, etc.) is unaffected"

## Files

- `src/execution/types.ts`
- `src/execution/executor.ts`

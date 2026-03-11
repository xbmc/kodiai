# T02: 97-multi-llm-routing-cost-tracking 02

**Slice:** S01 — **Milestone:** M020

## Description

Create the Postgres migration for llm_cost_events and the cost tracking module that logs every LLM invocation with model, provider, token counts, and estimated USD cost.

Purpose: Provide full cost visibility per invocation, queryable along any dimension (repo, task type, model, provider, time). This is the data foundation for cost monitoring.
Output: Migration 010, cost tracker module, extended telemetry store.

## Must-Haves

- [ ] "Every LLM invocation (AI SDK and Agent SDK) can be logged to Postgres with model, provider, tokens, and cost"
- [ ] "llm_cost_events table exists with full-dimensional schema queryable by repo, task type, model, provider"
- [ ] "Cost estimation uses pricing config (not hardcoded) to compute estimated USD"
- [ ] "Agent SDK execution costs are also written to llm_cost_events for unified querying"

## Files

- `src/db/migrations/010-llm-cost-events.sql`
- `src/db/migrations/010-llm-cost-events.down.sql`
- `src/llm/cost-tracker.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`

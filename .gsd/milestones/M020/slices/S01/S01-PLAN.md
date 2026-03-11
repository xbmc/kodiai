# S01: Multi Llm Routing Cost Tracking

**Goal:** Install AI SDK packages and build the task routing foundation layer: task type taxonomy, provider registry, task router with wildcard resolution, pricing configuration, and .
**Demo:** Install AI SDK packages and build the task routing foundation layer: task type taxonomy, provider registry, task router with wildcard resolution, pricing configuration, and .

## Must-Haves


## Tasks

- [x] **T01: 97-multi-llm-routing-cost-tracking 01** `est:3min`
  - Install AI SDK packages and build the task routing foundation layer: task type taxonomy, provider registry, task router with wildcard resolution, pricing configuration, and .kodiai.yml models: schema extension.

Purpose: Establish the routing infrastructure that Plan 03 will wire into the execution path. All downstream LLM calls need a resolved model before they can route or track costs.
Output: `src/llm/` module with task types, router, providers, pricing; extended config schema.
- [x] **T02: 97-multi-llm-routing-cost-tracking 02** `est:2min`
  - Create the Postgres migration for llm_cost_events and the cost tracking module that logs every LLM invocation with model, provider, token counts, and estimated USD cost.

Purpose: Provide full cost visibility per invocation, queryable along any dimension (repo, task type, model, provider, time). This is the data foundation for cost monitoring.
Output: Migration 010, cost tracker module, extended telemetry store.
- [x] **T03: 97-multi-llm-routing-cost-tracking 03** `est:3min`
  - Build the generateText wrapper with fallback logic and wire the task routing + cost tracking into the existing executor and handler call sites.

Purpose: Complete the routing layer by connecting the foundation (Plan 01/02) to actual LLM call sites. After this plan, non-agentic tasks route through AI SDK, agentic tasks continue on Agent SDK, all calls are cost-tracked, and fallback handles provider failures.
Output: Working generate wrapper, modified executor with cost tracking, handler integration points.

## Files Likely Touched

- `src/llm/task-types.ts`
- `src/llm/providers.ts`
- `src/llm/task-router.ts`
- `src/llm/pricing.ts`
- `src/llm/index.ts`
- `src/execution/config.ts`
- `src/db/migrations/010-llm-cost-events.sql`
- `src/db/migrations/010-llm-cost-events.down.sql`
- `src/llm/cost-tracker.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/llm/generate.ts`
- `src/llm/fallback.ts`
- `src/llm/index.ts`
- `src/execution/executor.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/slack/assistant.ts`

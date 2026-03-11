---
id: S01
parent: M020
milestone: M020
provides:
  - Task type taxonomy with dot-separated hierarchy
  - Provider model factory for AI SDK instances
  - Task router with wildcard resolution
  - Pricing configuration from JSON
  - Config schema extension for models section
  - generateWithFallback wrapper for AI SDK generateText()
  - Fallback detection for 429/5xx/timeout errors
  - Executor integration with TaskRouter and CostTracker
  - Handler taskType threading for all three handler types
  - llm_cost_events Postgres table with full-dimensional schema
  - LlmCostRecord type for cost tracking
  - CostTracker module with trackAiSdkCall and trackAgentSdkCall
  - TelemetryStore.recordLlmCost() method
requires: []
affects: []
key_files: []
key_decisions:
  - "Pricing loaded from JSON config file, not hardcoded in source"
  - "Wildcard matching uses longest prefix for specificity"
  - "Non-Claude models on agentic tasks get AI SDK with warning"
  - "Agentic tasks continue on Agent SDK in v1; router sdk field is for future use"
  - "Slack handler taskType set in index.ts wiring, not in assistant-handler.ts"
  - "Cost tracker methods are fire-and-forget, never throw"
  - "Agent SDK cost uses provided costUsd when available, falls back to estimateCost"
patterns_established:
  - "Dot-separated task type taxonomy for LLM routing"
  - "Provider factory pattern mapping model IDs to AI SDK instances"
  - "generateWithFallback wrapper for all AI SDK calls with cost tracking"
  - "taskType field on ExecutionContext for routing and cost attribution"
  - "Fire-and-forget cost tracking that never blocks execution"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-26
blocker_discovered: false
---
# S01: Multi Llm Routing Cost Tracking

**# Phase 97 Plan 01: Task Routing Foundation Summary**

## What Happened

# Phase 97 Plan 01: Task Routing Foundation Summary

**AI SDK packages installed with task type taxonomy, provider registry, task router with wildcard resolution, and config-driven pricing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-26T01:41:35Z
- **Completed:** 2026-02-26T01:44:26Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Installed AI SDK packages (ai, @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google)
- Created task type taxonomy with 6 task types and agentic classification
- Built provider factory mapping model IDs to AI SDK provider instances
- Task router resolves with exact > wildcard > category > global default precedence
- Pricing loaded from JSON config file with cost estimation
- Extended .kodiai.yml schema with models, defaultModel, defaultFallbackModel

## Task Commits

1. **Task 1: Install AI SDK packages and create task types + provider registry** - `3b1748f2` (feat)
2. **Task 2: Create task router, pricing config, config schema extension, and barrel index** - `aa4c50dd` (feat)

## Files Created/Modified
- `src/llm/task-types.ts` - Task type constants and agentic classification
- `src/llm/providers.ts` - Provider model factory for AI SDK instances
- `src/llm/task-router.ts` - Task router with wildcard resolution
- `src/llm/pricing.ts` - Pricing config loader and cost estimation
- `src/llm/pricing.json` - Model pricing data (Anthropic, OpenAI, Google)
- `src/llm/index.ts` - Barrel exports for LLM module
- `src/execution/config.ts` - Extended repoConfigSchema with models section
- `package.json` - Added AI SDK dependencies

## Decisions Made
- Pricing loaded from JSON config file (not hardcoded) for easy updates
- Wildcard matching uses longest prefix match for specificity
- Non-Claude models on agentic tasks use AI SDK with logged warning

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Task routing foundation complete, ready for Plan 02 (cost tracking) and Plan 03 (generate wrapper + wiring)
- All exports available via src/llm/index.ts barrel

---
*Phase: 97-multi-llm-routing-cost-tracking*
*Completed: 2026-02-26*

# Phase 97 Plan 03: Generate Wrapper and Executor Wiring Summary

**generateWithFallback wrapper with 429/5xx/timeout fallback, cost tracking in executor, and taskType threading through all handlers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-26T01:49:30Z
- **Completed:** 2026-02-26T01:52:30Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Built generateWithFallback wrapper around AI SDK generateText() with automatic fallback
- Fallback triggers on 429 rate limits, 5xx errors, and timeouts
- Fallback produces visible annotation in output for transparency
- Executor integrates TaskRouter for model resolution and CostTracker for Agent SDK cost logging
- All three handler types (review, mention, Slack) set taskType on ExecutionContext
- All new dependencies are optional for backward compatibility

## Task Commits

1. **Task 1: Create fallback detection and generateWithFallback wrapper** - `3ea381a8` (feat)
2. **Task 2: Wire task router and cost tracking into executor and handlers** - `a4e2e7c1` (feat)

## Files Created/Modified
- `src/llm/fallback.ts` - isFallbackTrigger and getFallbackReason
- `src/llm/generate.ts` - generateWithFallback wrapper
- `src/llm/index.ts` - Added fallback and generate exports
- `src/execution/executor.ts` - TaskRouter + CostTracker integration
- `src/execution/types.ts` - Added taskType to ExecutionContext
- `src/handlers/review.ts` - Set taskType="review.full" on both primary and retry execute calls
- `src/handlers/mention.ts` - Set taskType="mention.response"
- `src/index.ts` - Set taskType="slack.response" on both Slack execute bridges

## Decisions Made
- Agentic tasks continue on Agent SDK in v1; router sdk field for future use
- Slack handler taskType set at index.ts wiring layer (not inside assistant-handler.ts)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AI SDK v6 usage property names**
- **Found during:** Task 1 (generateWithFallback)
- **Issue:** Used `promptTokens`/`completionTokens` but AI SDK v6 uses `inputTokens`/`outputTokens`
- **Fix:** Changed to correct property names
- **Files modified:** src/llm/generate.ts
- **Verification:** TypeScript compiles clean
- **Committed in:** 3ea381a8 (part of task commit)

**2. [Rule 3 - Blocking] Slack handler file name mismatch**
- **Found during:** Task 2 (handler wiring)
- **Issue:** Plan referenced `src/slack/assistant.ts` but actual file is `src/slack/assistant-handler.ts`
- **Fix:** Set taskType at index.ts wiring layer instead (correct integration point)
- **Files modified:** src/index.ts
- **Verification:** Both Slack execute bridges have taskType set
- **Committed in:** a4e2e7c1 (part of task commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 97 complete, all 3 plans executed
- Multi-LLM routing and cost tracking fully wired

---
*Phase: 97-multi-llm-routing-cost-tracking*
*Completed: 2026-02-26*

# Phase 97 Plan 02: Cost Tracking Storage Summary

**Postgres migration for llm_cost_events with fire-and-forget CostTracker module for per-invocation cost visibility**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T01:45:17Z
- **Completed:** 2026-02-26T01:47:10Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created migration 010 with llm_cost_events table and 5 indexes
- Added LlmCostRecord type to telemetry types
- Implemented recordLlmCost in TelemetryStore with fail-open error handling
- Built CostTracker module with trackAiSdkCall and trackAgentSdkCall
- Extended purgeOlderThan to include llm_cost_events cleanup

## Task Commits

1. **Task 1: Create llm_cost_events migration and LlmCostRecord type** - `52caa11f` (feat)
2. **Task 2: Implement recordLlmCost in telemetry store and create cost tracker module** - `509af3db` (feat)

## Files Created/Modified
- `src/db/migrations/010-llm-cost-events.sql` - llm_cost_events table with indexes
- `src/db/migrations/010-llm-cost-events.down.sql` - Rollback migration
- `src/llm/cost-tracker.ts` - CostTracker factory with AI SDK and Agent SDK tracking
- `src/telemetry/types.ts` - LlmCostRecord type and recordLlmCost method
- `src/telemetry/store.ts` - recordLlmCost implementation and purge extension
- `src/llm/index.ts` - Added cost tracker exports

## Decisions Made
- Cost tracker methods are fire-and-forget, never throw (fail-open philosophy)
- Agent SDK tracking uses provided costUsd from resultMessage when available

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Cost tracking infrastructure complete, ready for Plan 03 wiring
- CostTracker available via src/llm/index.ts barrel

---
*Phase: 97-multi-llm-routing-cost-tracking*
*Completed: 2026-02-26*

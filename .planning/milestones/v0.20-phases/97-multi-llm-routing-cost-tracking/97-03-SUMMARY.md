---
phase: 97-multi-llm-routing-cost-tracking
plan: 03
subsystem: llm
tags: [ai-sdk, generateText, fallback, cost-tracking, executor, routing]

requires:
  - phase: 97-01
    provides: Task router, provider factory, task types
  - phase: 97-02
    provides: CostTracker, TelemetryStore.recordLlmCost
provides:
  - generateWithFallback wrapper for AI SDK generateText()
  - Fallback detection for 429/5xx/timeout errors
  - Executor integration with TaskRouter and CostTracker
  - Handler taskType threading for all three handler types
affects: [execution, handlers, slack]

tech-stack:
  added: []
  patterns: [generateWithFallback, fallback-annotation, fire-and-forget-cost-tracking]

key-files:
  created:
    - src/llm/fallback.ts
    - src/llm/generate.ts
  modified:
    - src/llm/index.ts
    - src/execution/executor.ts
    - src/execution/types.ts
    - src/handlers/review.ts
    - src/handlers/mention.ts
    - src/index.ts

key-decisions:
  - "Agentic tasks continue on Agent SDK in v1; router sdk field is for future use"
  - "Slack handler taskType set in index.ts wiring, not in assistant-handler.ts"

patterns-established:
  - "generateWithFallback wrapper for all AI SDK calls with cost tracking"
  - "taskType field on ExecutionContext for routing and cost attribution"

requirements-completed: [LLM-01, LLM-04]

duration: 3min
completed: 2026-02-26
---

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

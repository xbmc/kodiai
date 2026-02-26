---
phase: 97-multi-llm-routing-cost-tracking
plan: 01
subsystem: llm
tags: [ai-sdk, anthropic, openai, google, task-routing, pricing, zod]

requires:
  - phase: None
    provides: Foundational LLM routing layer
provides:
  - Task type taxonomy with dot-separated hierarchy
  - Provider model factory for AI SDK instances
  - Task router with wildcard resolution
  - Pricing configuration from JSON
  - Config schema extension for models section
affects: [97-02, 97-03, execution, handlers]

tech-stack:
  added: [ai@6.0, "@ai-sdk/anthropic@3.0", "@ai-sdk/openai@3.0", "@ai-sdk/google@3.0"]
  patterns: [task-type-taxonomy, provider-factory, wildcard-routing, config-driven-pricing]

key-files:
  created:
    - src/llm/task-types.ts
    - src/llm/providers.ts
    - src/llm/task-router.ts
    - src/llm/pricing.ts
    - src/llm/pricing.json
    - src/llm/index.ts
  modified:
    - src/execution/config.ts
    - package.json

key-decisions:
  - "Pricing loaded from JSON config file, not hardcoded in source"
  - "Wildcard matching uses longest prefix for specificity"
  - "Non-Claude models on agentic tasks get AI SDK with warning"

patterns-established:
  - "Dot-separated task type taxonomy for LLM routing"
  - "Provider factory pattern mapping model IDs to AI SDK instances"

requirements-completed: [LLM-02, LLM-03]

duration: 3min
completed: 2026-02-26
---

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

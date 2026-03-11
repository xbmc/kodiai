# T03: 97-multi-llm-routing-cost-tracking 03

**Slice:** S01 — **Milestone:** M020

## Description

Build the generateText wrapper with fallback logic and wire the task routing + cost tracking into the existing executor and handler call sites.

Purpose: Complete the routing layer by connecting the foundation (Plan 01/02) to actual LLM call sites. After this plan, non-agentic tasks route through AI SDK, agentic tasks continue on Agent SDK, all calls are cost-tracked, and fallback handles provider failures.
Output: Working generate wrapper, modified executor with cost tracking, handler integration points.

## Must-Haves

- [ ] "Non-agentic tasks complete via AI SDK generateText() using the configured model"
- [ ] "Agentic tasks (PR review, mentions, Slack) still use Agent SDK query() by default"
- [ ] "Changing models: in .kodiai.yml causes a different model to be used on next invocation"
- [ ] "When configured provider is unavailable (429, 5xx, timeout), task falls back to default model"
- [ ] "Fallback triggers a visible annotation in the output"
- [ ] "If all models fail, optional signals degrade gracefully; core tasks fail hard"
- [ ] "Every AI SDK and Agent SDK invocation is cost-tracked via CostTracker"

## Files

- `src/llm/generate.ts`
- `src/llm/fallback.ts`
- `src/llm/index.ts`
- `src/execution/executor.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/slack/assistant.ts`

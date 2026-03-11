# T01: 97-multi-llm-routing-cost-tracking 01

**Slice:** S01 — **Milestone:** M020

## Description

Install AI SDK packages and build the task routing foundation layer: task type taxonomy, provider registry, task router with wildcard resolution, pricing configuration, and .kodiai.yml models: schema extension.

Purpose: Establish the routing infrastructure that Plan 03 will wire into the execution path. All downstream LLM calls need a resolved model before they can route or track costs.
Output: `src/llm/` module with task types, router, providers, pricing; extended config schema.

## Must-Haves

- [ ] "Task types use dot-separated hierarchy (review.full, slack.response, cluster.label)"
- [ ] "TaskRouter resolves a task type string to a concrete model+provider+sdk tuple"
- [ ] "Wildcard matching works (review.* matches review.full, review.summary)"
- [ ] "Exact match takes priority over wildcard match"
- [ ] ".kodiai.yml models: section parsed and validated by config schema"
- [ ] "Provider factory creates AI SDK model instances from model ID strings"
- [ ] "Pricing config loaded from JSON file, not hardcoded in source"

## Files

- `src/llm/task-types.ts`
- `src/llm/providers.ts`
- `src/llm/task-router.ts`
- `src/llm/pricing.ts`
- `src/llm/index.ts`
- `src/execution/config.ts`

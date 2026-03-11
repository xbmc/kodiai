# T02: 69-snippet-anchors-prompt-budgeting 02

**Slice:** S04 — **Milestone:** M012

## Description

Integrate RET-08 snippet anchors and strict prompt budgeting into live review and mention pipelines.

Purpose: Complete Phase 69 outcome by making retrieval context more actionable (`path:line` + concise snippet evidence) while guaranteeing prompt-size safety and fail-open behavior across both user-facing surfaces.
Output: Handlers enrich retrieval findings with snippet anchors, prompt builders render anchor-aware context, and regressions lock overflow/fallback behavior.

## Must-Haves

- [ ] "Review and mention prompts include retrieval evidence with `path:line` anchors and concise snippets when extraction succeeds"
- [ ] "Retrieval evidence always respects strict prompt budgets and drops lowest-value context first when overflowing"
- [ ] "If snippet extraction fails, both surfaces still respond using path-only retrieval evidence instead of failing"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`

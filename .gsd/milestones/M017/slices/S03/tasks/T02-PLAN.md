# T02: 88-knowledge-layer-extraction 02

**Slice:** S03 — **Milestone:** M017

## Description

Wire all handlers (review, mention, Slack assistant) to use the unified `src/knowledge/` module, add Slack retrieval support, write the E2E test, and delete `src/learning/` entirely.

Purpose: Complete the knowledge layer extraction by making all consumers use the unified module, proving shared code path with an E2E test, and removing the old `src/learning/` directory.

Output: Refactored handlers, Slack retrieval, E2E test, deleted `src/learning/`.

## Must-Haves

- [ ] "Handlers call retrieve() from src/knowledge/ and get back final ranked results without orchestrating reranking/thresholds"
- [ ] "Slack assistant handler retrieves context from the same knowledge module as GitHub review"
- [ ] "No import from src/learning/ exists anywhere in the codebase"
- [ ] "E2E test proves Slack and PR review use the same retrieve() code path"

## Files

- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/slack/assistant-handler.ts`
- `src/index.ts`
- `src/learning/`

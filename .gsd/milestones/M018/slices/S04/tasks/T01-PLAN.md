# T01: 92-wire-unified-retrieval-consumers 01

**Slice:** S04 — **Milestone:** M018

## Description

Wire the mention handler to forward unified cross-corpus retrieval results to the mention prompt builder, and update mention-prompt.ts to format unified context with inline source citations.

Purpose: @mention responses currently only use legacy code findings. This plan wires the unified pipeline output (wiki + review + code) through to the mention prompt with [wiki: Name] and [review: PR #123] citation markers.
Output: mention.ts forwards unifiedResults/contextWindow; mention-prompt.ts renders attributed context.

## Must-Haves

- [ ] "@mention responses include wiki citations with [wiki: Page Title] markers when wiki hits exist"
- [ ] "@mention responses include review citations with [review: PR #123] markers when review hits exist"
- [ ] "@mention responses silently fall back to code-only context when no wiki/review hits exist"
- [ ] "Mention handler forwards unifiedResults and contextWindow from retriever to prompt builder"

## Files

- `src/handlers/mention.ts`
- `src/execution/mention-prompt.ts`

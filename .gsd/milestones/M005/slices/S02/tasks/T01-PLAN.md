# T01: 31-incremental-re-review-with-retrieval-context 01

**Slice:** S02 — **Milestone:** M005

## Description

Add config schema extensions and KnowledgeStore query methods for incremental re-review.

Purpose: Phase 31 needs config support for the `pull_request.synchronize` trigger and retrieval tuning knobs, plus KnowledgeStore queries to look up the last reviewed head SHA and prior findings for a PR. These are the data-layer foundations that the review handler wiring (Plan 02/03) depends on.

Output: Extended config schema, two new KnowledgeStore methods with tests, all backward compatible.

## Must-Haves

- [ ] "Config schema accepts review.triggers.onSynchronize boolean (default false)"
- [ ] "Config schema accepts knowledge.retrieval settings (enabled, topK, distanceThreshold, maxContextChars)"
- [ ] "KnowledgeStore can return the head_sha of the most recent completed review for a given repo+PR"
- [ ] "KnowledgeStore can return unsuppressed findings from the most recent completed review of a PR"
- [ ] "Existing configs without new fields parse without errors (backward compatible)"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`

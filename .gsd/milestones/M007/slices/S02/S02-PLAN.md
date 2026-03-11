# S02: Incremental Re Review With Retrieval Context

**Goal:** Add config schema extensions and KnowledgeStore query methods for incremental re-review.
**Demo:** Add config schema extensions and KnowledgeStore query methods for incremental re-review.

## Must-Haves


## Tasks

- [x] **T01: 31-incremental-re-review-with-retrieval-context 01** `est:3min`
  - Add config schema extensions and KnowledgeStore query methods for incremental re-review.

Purpose: Phase 31 needs config support for the `pull_request.synchronize` trigger and retrieval tuning knobs, plus KnowledgeStore queries to look up the last reviewed head SHA and prior findings for a PR. These are the data-layer foundations that the review handler wiring (Plan 02/03) depends on.

Output: Extended config schema, two new KnowledgeStore methods with tests, all backward compatible.
- [x] **T02: 31-incremental-re-review-with-retrieval-context 02** `est:2min`
  - Create the incremental diff computation and finding deduplication utility modules.

Purpose: These are pure logic modules that determine (1) which files changed since the last reviewed head SHA and (2) which prior findings to suppress vs keep as context. They are stateless utilities consumed by the review handler in Plan 03.

Output: Two tested modules with clear type contracts.
- [x] **T03: 31-incremental-re-review-with-retrieval-context 03** `est:4min`
  - Wire incremental diff, finding deduplication, and retrieval context into the review handler and prompt builder.

Purpose: This is the integration plan that connects all Phase 31 infrastructure (config, KnowledgeStore queries, incremental diff, finding dedup, retrieval) into the live review pipeline. After this plan, synchronize events trigger incremental re-reviews, prior findings inform dedup, and learning memory enriches prompts.

Output: Working incremental re-review with retrieval context, all fail-open.

## Files Likely Touched

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/lib/incremental-diff.ts`
- `src/lib/finding-dedup.ts`
- `src/lib/incremental-diff.test.ts`
- `src/lib/finding-dedup.test.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`

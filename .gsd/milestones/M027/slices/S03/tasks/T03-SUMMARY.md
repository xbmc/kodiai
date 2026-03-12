---
id: T03
parent: S03
milestone: M027
provides:
  - Shared repair adapters and durable store helpers for issues, issue_comments, learning_memories, and code_snippets
key_files:
  - src/knowledge/embedding-repair.ts
  - src/knowledge/issue-store.ts
  - src/knowledge/memory-store.ts
  - src/knowledge/code-snippet-store.ts
  - src/knowledge/embedding-repair.test.ts
key_decisions:
  - Issue comment repair rebuilds embedding text by joining persisted issue_comments rows to persisted issues titles instead of re-fetching GitHub data or inventing stale support.
patterns_established:
  - Non-wiki repair stores expose the same list/get/save/write helpers against embedding_repair_state while preserving corpus-specific stale semantics and persisted-text-only boundaries.
observability_surfaces:
  - embedding_repair_state rows for issues, issue_comments, learning_memories, and code_snippets now use the shared per-corpus cursor/count/failure contract
  - bun test src/knowledge/embedding-repair.test.ts
  - bun test ./scripts/embedding-repair.test.ts ./scripts/verify-m027-s03.test.ts
duration: 55m
verification_result: passed
completed_at: 2026-03-11T15:20:21-07:00
blocker_discovered: false
---

# T03: Add the remaining corpus adapters and store repair selectors

**Added the remaining non-wiki repair adapters plus store-level degraded-row selectors, repair-state persistence, and batched embedding writes for issues, issue_comments, learning_memories, and code_snippets.**

## What Happened

I extended `src/knowledge/embedding-repair.ts` from the review-comment-only path to a shared adapter surface for all remaining non-wiki corpora. The engine now exports scoped repair-store wrappers for `issues`, `issue_comments`, `learning_memories`, and `code_snippets`, plus runner helpers that reuse the same persisted-row embedding flow as `review_comments`.

On the store side, I added repair helpers to:

- `src/knowledge/issue-store.ts` for `issues` and `issue_comments`
- `src/knowledge/memory-store.ts` for `learning_memories`
- `src/knowledge/code-snippet-store.ts` for `code_snippets`

Those helpers now:

- truthfully select degraded rows using each corpus’s real schema semantics
- read/write the shared `embedding_repair_state` table
- batch-write repaired embeddings back to the source corpus table
- clear `stale` only for corpora that actually support it

Important corpus-specific behavior preserved:

- `issues` and `issue_comments` repair only on null/missing embedding or wrong model; no fake stale support was added
- `issue_comments` rebuild text from persisted comment body plus persisted parent issue title via a DB join
- `learning_memories` and `code_snippets` include null/stale/wrong-model selection semantics
- `code_snippets` repair is limited to persisted `code_snippets` rows with `embedded_text`; it does not treat occurrence metadata as reconstructable repair text

I also expanded `src/knowledge/embedding-repair.test.ts` to verify the new scoped adapter behavior and mismatch guarding.

## Verification

Passed:

- `bun test src/knowledge/embedding-repair.test.ts`
- `bun test src/knowledge/embedding-repair.test.ts scripts/embedding-repair.test.ts scripts/verify-m027-s03.test.ts src/knowledge/issue-store.test.ts src/knowledge/memory-store.test.ts src/knowledge/code-snippet-store.test.ts`
  - Relevant result: `embedding-repair.test.ts` passed, `code-snippet-store.test.ts` passed, DB-backed issue/memory tests remained skipped without `TEST_DATABASE_URL`

Expected pending slice-level failures:

- `bun test ./scripts/embedding-repair.test.ts ./scripts/verify-m027-s03.test.ts`
  - still fails because T04/T05 CLI and proof-harness files are not implemented yet, which matches the current slice order

## Diagnostics

Future agents can inspect the new repair surfaces in these places:

- `src/knowledge/embedding-repair.ts` — corpus-scoped repair-store adapters and runner entrypoints
- `src/knowledge/issue-store.ts` — degraded-row selectors for `issues` and `issue_comments`, including persisted parent-title join for comment repair
- `src/knowledge/memory-store.ts` — degraded-row selector and batched repair writes for `learning_memories`
- `src/knowledge/code-snippet-store.ts` — persisted-snippet-only repair selector and batched repair writes for `code_snippets`
- `embedding_repair_state` — durable per-corpus repair cursor/progress/failure state

## Deviations

None.

## Known Issues

- `scripts/embedding-repair.ts` is still missing, so CLI-contract tests fail until T04.
- `scripts/verify-m027-s03.ts` is still missing, so proof-harness tests fail until T05.
- DB-backed `issue-store` and `memory-store` integration tests were not runnable in this session because `TEST_DATABASE_URL` was not set.

## Files Created/Modified

- `src/knowledge/embedding-repair.ts` — added generic scoped repair-store adapters and runner helpers for the remaining non-wiki corpora
- `src/knowledge/issue-store.ts` — added `issues`/`issue_comments` repair selectors, durable repair-state reads/writes, and batched embedding updates
- `src/knowledge/memory-store.ts` — added `learning_memories` repair selectors, durable repair-state reads/writes, and batched embedding updates
- `src/knowledge/code-snippet-store.ts` — added persisted-snippet-only repair selectors, durable repair-state reads/writes, and batched embedding updates
- `src/knowledge/issue-types.ts` — added repair candidate and repair-helper interface fields for issue corpora
- `src/knowledge/types.ts` — added learning-memory repair candidate and repair-helper interface fields
- `src/knowledge/code-snippet-types.ts` — added code-snippet repair candidate and repair-helper interface fields
- `src/knowledge/embedding-repair.test.ts` — added adapter-scoping coverage for the new corpus repair store wrappers
- `.gsd/DECISIONS.md` — recorded the persisted-title join decision for issue comment repair

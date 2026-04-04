---
id: T02
parent: S02
milestone: M035
key_files:
  - src/knowledge/runtime.ts
  - src/knowledge/runtime.test.ts
key_decisions:
  - Keep rerank provider construction unconditional in `createKnowledgeRuntime`; the provider factory already implements the no-op/no-key path cleanly.
  - Prove runtime wiring with a narrow composition test (`runtime.test.ts`) using a tagged-sql stub and logger spy instead of DB-backed setup or module mocking.
duration: 
verification_result: passed
completed_at: 2026-04-04T16:39:26.052Z
blocker_discovered: false
---

# T02: Threaded rerank provider through runtime composition and added a focused startup-wiring regression test.

**Threaded rerank provider through runtime composition and added a focused startup-wiring regression test.**

## What Happened

Extended `src/knowledge/runtime.ts` to import `createRerankProvider` and `RerankProvider`, added `rerankProvider` to the `KnowledgeRuntime` surface, constructed the provider during runtime initialization, logged `logger.info({ model: rerankProvider.model }, "Rerank provider initialized")`, passed the provider into `createRetriever`, and returned it from `createKnowledgeRuntime`. During the first edit pass, `runtime.ts` accumulated duplicate trailing content from exact-replace retries, so the file was rewritten cleanly in one pass to remove the artifact and land the wiring deterministically. Added `src/knowledge/runtime.test.ts`, which builds a lightweight `Sql` stub and logger spy, asserts that `createKnowledgeRuntime()` exposes a rerank provider with model `rerank-2.5`, verifies the no-key rerank provider returns `null`, and confirms the startup log contains the expected rerank model message.

## Verification

`bun test ./src/knowledge/runtime.test.ts && bun run tsc --noEmit` exits clean. The runtime test proves the provider is exposed on `KnowledgeRuntime` and that startup logging includes the rerank model signal.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/runtime.test.ts && bun run tsc --noEmit` | 0 | ✅ pass | 6500ms |

## Deviations

Rewrote `src/knowledge/runtime.ts` wholesale instead of applying smaller edits after repeated exact-replace attempts left duplicate tail artifacts in the file. The resulting logic matches the planned wiring but the implementation path was a full-file cleanup rather than incremental patching.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/runtime.ts`
- `src/knowledge/runtime.test.ts`

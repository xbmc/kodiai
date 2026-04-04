# S02: Reranker Pipeline Wiring + Runtime Integration — UAT

**Milestone:** M035
**Written:** 2026-04-04T16:43:03.329Z

# UAT — S02 Reranker Pipeline Wiring + Runtime Integration

## Scenario
Verify that the retrieval pipeline performs neural reranking when a provider is present, remains fail-open when reranking is unavailable, and that runtime startup exposes the rerank model.

## Steps
1. Run `bun test ./src/knowledge/runtime.test.ts`.
2. Run `bun test ./src/knowledge/retrieval.test.ts`.
3. Run `bun run tsc --noEmit`.

## Expected
- Runtime test passes and proves `createKnowledgeRuntime()` exposes `rerankProvider.model === "rerank-2.5"` and logs `Rerank provider initialized`.
- Retrieval test passes and proves successful reorder, null-return fail-open behavior, and absent-provider behavior.
- TypeScript exits clean with no compile errors.


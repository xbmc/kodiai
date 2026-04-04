---
estimated_steps: 4
estimated_files: 4
skills_used:
  - test
---

# T02: Thread rerank provider through runtime composition and prove startup wiring

**Slice:** S02 — Reranker Pipeline Wiring + Runtime Integration
**Milestone:** M035

## Description

Wire the S01 rerank provider into `createKnowledgeRuntime`, expose it on the `KnowledgeRuntime` return type, and add a focused runtime test that proves the provider is constructed and that startup logging exposes the rerank model.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `createRerankProvider({ apiKey, logger })` | Keep startup fail-open semantics by using the provider factory as designed; do not add a new hard failure path in runtime composition | No special handling needed at construction time because the provider only performs network I/O when used later | Treat provider creation as opaque and verify the exposed runtime surface plus logger behavior in tests |
| `createKnowledgeRuntime()` store initialization | Preserve existing store fail-open behavior; do not let the new provider wiring change current startup behavior | Existing startup paths already tolerate degraded stores; the rerank provider must not add blocking work | Runtime test should stub logger/sql surfaces tightly enough to verify the rerank wiring without depending on external services |

## Load Profile

- **Shared resources**: Runtime startup logging and the same Voyage API key surface already used by embedding providers
- **Per-operation cost**: One provider construction during runtime initialization and one extra startup log line
- **10x breakpoint**: Many runtimes starting concurrently would amplify startup log volume, not CPU or memory pressure; the main scaling risk remains later rerank API usage handled by T01 fail-open behavior

## Negative Tests

- **Malformed inputs**: Blank or missing `VOYAGE_API_KEY` should still produce a no-op rerank provider and a stable runtime surface
- **Error paths**: Runtime wiring test should fail if the provider is not exposed or if startup logging omits the rerank model signal
- **Boundary conditions**: Runtime with minimal stubbed dependencies should still construct `rerankProvider` and `retriever` consistently

## Steps

1. Update `src/knowledge/runtime.ts` imports to bring in `createRerankProvider` and `RerankProvider`, then construct `const rerankProvider = createRerankProvider({ apiKey: voyageApiKey, logger })` alongside the other providers.
2. Add `rerankProvider: RerankProvider` to `KnowledgeRuntime`, pass `rerankProvider` into the `createRetriever` dependency object, and include it in the returned runtime object.
3. Emit `logger.info({ model: rerankProvider.model }, "Rerank provider initialized")` during startup, without removing the existing embedding-provider logs.
4. Add `src/knowledge/runtime.test.ts` to assert the returned runtime exposes `rerankProvider` and that the logger observed the expected rerank-model initialization message, then run the task verification commands.

## Must-Haves

- [ ] `KnowledgeRuntime` exposes `rerankProvider: RerankProvider`
- [ ] `createKnowledgeRuntime` always constructs the rerank provider and passes it into `createRetriever`
- [ ] Startup logs expose the rerank model via `logger.info`
- [ ] `src/knowledge/runtime.test.ts` proves the runtime wiring contract

## Verification

- `bun test ./src/knowledge/runtime.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: startup `logger.info({ model: rerankProvider.model }, "Rerank provider initialized")`
- How a future agent inspects this: run `bun test ./src/knowledge/runtime.test.ts` or inspect startup logs for the rerank model line
- Failure state exposed: missing provider wiring or missing startup log becomes a direct test failure

## Inputs

- `src/knowledge/runtime.ts` — runtime composition surface to extend
- `src/knowledge/embeddings.ts` — source of `createRerankProvider`
- `src/knowledge/types.ts` — `RerankProvider` type used on `KnowledgeRuntime`
- `src/knowledge/retrieval.ts` — retriever dependency surface that must now accept `rerankProvider`

## Expected Output

- `src/knowledge/runtime.ts` — rerank provider created, logged, passed to retrieval, and returned on the runtime surface
- `src/knowledge/runtime.test.ts` — executable regression test for runtime rerank wiring and startup logging

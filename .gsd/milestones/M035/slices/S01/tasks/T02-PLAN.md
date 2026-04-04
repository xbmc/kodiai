---
estimated_steps: 67
estimated_files: 3
skills_used: []
---

# T02: Add RerankProvider type and implement createRerankProvider with unit tests

Add the RerankProvider type to types.ts, implement createRerankProvider in embeddings.ts following the established voyageFetch pattern, and create embeddings.test.ts with full unit test coverage.

Steps:
1. In src/knowledge/types.ts, after the EmbeddingProvider type (around line 359), add:
```ts
export type RerankProvider = {
  rerank(opts: { query: string; documents: string[]; topK?: number }): Promise<number[] | null>;
  readonly model: string;
};
```

2. In src/knowledge/embeddings.ts, add:
   a. Near the top constants: `const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";`
   b. New interface after the existing Voyage response interfaces:
   ```ts
   interface VoyageRerankResponse {
     data?: Array<{ index: number; relevance_score: number }>;
     model?: string;
   }
   ```
   c. At the end of the file (or near the other provider factories), add `createRerankProvider`:
   ```ts
   export function createRerankProvider(opts: {
     apiKey: string;
     logger: Logger;
   }): RerankProvider {
     const { apiKey, logger } = opts;
     if (!apiKey) {
       logger.info("Rerank provider disabled -- using no-op provider (no apiKey)");
       return {
         async rerank(_opts) { return null; },
         get model() { return "rerank-2.5"; },
       };
     }
     return {
       async rerank({ query, documents, topK }: { query: string; documents: string[]; topK?: number }): Promise<number[] | null> {
         const body: Record<string, unknown> = { query, documents, model: "rerank-2.5" };
         if (topK !== undefined) body.top_k = topK;
         const response = await voyageFetch<VoyageRerankResponse>({
           url: VOYAGE_RERANK_URL,
           apiKey,
           body,
           timeoutMs: 30_000,
           maxRetries: 1,
           logger,
         });
         if (!response?.data?.length) {
           if (response !== null) {
             logger.warn({ model: "rerank-2.5" }, "Rerank response missing data (fail-open)");
           }
           return null;
         }
         return response.data.map(item => item.index);
       },
       get model() { return "rerank-2.5"; },
     };
   }
   ```
   Add `RerankProvider` to the import from "./types.ts" at the top of embeddings.ts.

3. Create src/knowledge/embeddings.test.ts with the following test cases using Bun's built-in test runner (import { test, expect, mock } from 'bun:test'):
   - "returns null when apiKey is empty" — createRerankProvider with empty string apiKey, calls rerank, expects null
   - "happy path: returns ordered indices" — mock voyageFetch (via global fetch mock) to return { data: [{index:1,relevance_score:0.9},{index:0,relevance_score:0.7}] }, expects [1, 0]
   - "fail-open on API 500" — mock fetch to return { ok: false, status: 500 }, expects null
   - "fail-open on network error" — mock fetch to throw, expects null
   - "fail-open on empty data array" — mock fetch to return { ok: true, json: { data: [] } }, expects null
   - "includes top_k in request body when topK provided" — capture request body, assert top_k is set
   - "model getter returns rerank-2.5" — check .model property

   Use mock fetch approach: import the function, then use globalThis.fetch = mock(...) before each test, restore after. Use a no-op logger (pino with silent level or a minimal stub with info/warn no-ops).

4. Run bun run tsc --noEmit and fix any type errors.

## Inputs

- ``src/knowledge/types.ts` — EmbeddingProvider type as insertion reference point`
- ``src/knowledge/embeddings.ts` — voyageFetch, existing provider factories as pattern reference`

## Expected Output

- ``src/knowledge/types.ts` — RerankProvider type exported`
- ``src/knowledge/embeddings.ts` — VOYAGE_RERANK_URL, VoyageRerankResponse, createRerankProvider exported`
- ``src/knowledge/embeddings.test.ts` — new test file, all tests pass`

## Verification

bun test ./src/knowledge/embeddings.test.ts && bun run tsc --noEmit 2>&1 | tail -5

## Observability Impact

createRerankProvider emits logger.warn({ model: 'rerank-2.5' }, 'Rerank response missing data (fail-open)') on non-null but empty/malformed API response — same pattern as createEmbeddingProvider. Fail-open on null voyageFetch result (API error) is silent at this layer (voyageFetch logs its own error).

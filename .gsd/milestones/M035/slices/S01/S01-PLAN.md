# S01: voyage-4 Embedding Upgrade + Reranker Client

**Goal:** Change DEFAULT_EMBEDDING_MODEL and NON_WIKI_TARGET_EMBEDDING_MODEL to "voyage-4", sweep all remaining hardcoded "voyage-code-3" strings from non-test source, and implement createRerankProvider in embeddings.ts with a matching RerankProvider type and unit tests.
**Demo:** After this: After this: grep for 'voyage-code-3' in non-test source returns zero hits; createRerankProvider exists and passes unit tests

## Tasks
- [x] **T01: Changed DEFAULT_EMBEDDING_MODEL and NON_WIKI_TARGET_EMBEDDING_MODEL to "voyage-4" and swept all 25 hardcoded "voyage-code-3" literals from 11 non-test source files** — Change the two exported model constants to "voyage-4" and fix every remaining hardcoded "voyage-code-3" literal in non-test source files. The embedding-audit.ts EXPECTED_CORPUS_MODELS map must also be updated — after this change, all existing DB rows (still on voyage-code-3) will show as model_mismatch in the next audit run. This is expected; the repair sweep will fix them.

Steps:
1. In src/knowledge/runtime.ts line 18: change DEFAULT_EMBEDDING_MODEL = "voyage-code-3" to "voyage-4".
2. In src/knowledge/embedding-repair.ts line 145: change NON_WIKI_TARGET_EMBEDDING_MODEL = "voyage-code-3" to "voyage-4".
3. In src/knowledge/review-comment-store.ts: replace all "voyage-code-3" literals (lines 171, 226, 412, 448) with "voyage-4" or import+use NON_WIKI_TARGET_EMBEDDING_MODEL from embedding-repair.ts where appropriate.
4. In src/knowledge/code-snippet-store.ts: same pattern as review-comment-store.ts (lines 274, 318).
5. In src/knowledge/wiki-store.ts (lines 114, 158): change "voyage-code-3" fallback defaults to "voyage-4".
6. In src/knowledge/memory-store.ts (lines 79, 292, 338): change "voyage-code-3" literals to "voyage-4".
7. In src/knowledge/review-comment-embedding-sweep.ts line 5: change EMBEDDING_MODEL = "voyage-code-3" to "voyage-4".
8. In src/knowledge/issue-store.ts (lines 188, 345, 416, 436, 479): change "voyage-code-3" literals to "voyage-4".
9. In src/knowledge/embedding-audit.ts (lines 20-25): update EXPECTED_CORPUS_MODELS map — change all non-wiki corpora entries (learning_memories, review_comments, code_snippets, issues, issue_comments) from "voyage-code-3" to "voyage-4".
10. In src/execution/config.ts (lines 244, 247, 327): update Zod schema defaults from "voyage-code-3" to "voyage-4".
11. In src/knowledge/cluster-matcher.ts line 36: update JSDoc comment text (no runtime impact).
12. Run the verification grep and confirm zero hits.
  - Estimate: 45m
  - Files: src/knowledge/runtime.ts, src/knowledge/embedding-repair.ts, src/knowledge/review-comment-store.ts, src/knowledge/code-snippet-store.ts, src/knowledge/wiki-store.ts, src/knowledge/memory-store.ts, src/knowledge/review-comment-embedding-sweep.ts, src/knowledge/issue-store.ts, src/knowledge/embedding-audit.ts, src/execution/config.ts, src/knowledge/cluster-matcher.ts
  - Verify: grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '\.test\.ts' | grep -c '' || true  # must print 0
- [x] **T02: Added RerankProvider type to types.ts, implemented createRerankProvider in embeddings.ts following voyageFetch fail-open pattern, and created embeddings.test.ts with 9 passing unit tests (TSC clean)** — Add the RerankProvider type to types.ts, implement createRerankProvider in embeddings.ts following the established voyageFetch pattern, and create embeddings.test.ts with full unit test coverage.

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
  - Estimate: 1h
  - Files: src/knowledge/types.ts, src/knowledge/embeddings.ts, src/knowledge/embeddings.test.ts
  - Verify: bun test ./src/knowledge/embeddings.test.ts && bun run tsc --noEmit 2>&1 | tail -5

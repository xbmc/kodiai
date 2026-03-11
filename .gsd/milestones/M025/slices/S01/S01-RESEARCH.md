# Phase 120: Embedding Migration - Research

**Researched:** 2026-03-02
**Domain:** Voyage AI embedding model migration (voyage-code-3 -> voyage-context-3 for wiki corpus)
**Confidence:** HIGH

## Summary

Phase 120 migrates the wiki corpus from `voyage-code-3` to `voyage-context-3` embeddings. The Voyage AI TypeScript SDK (v0.1.x, already installed) provides `client.contextualizedEmbed()` which accepts `inputs: string[][]` where each inner list is a set of chunks from the same document that get embedded with mutual context awareness. The existing `EmbeddingProvider` interface needs a new implementation (or extension) that calls `contextualizedEmbed()` instead of `embed()` for wiki document/query operations.

The `voyage-context-3` model defaults to 1024 dimensions (same as current `voyage-code-3`), so no schema migration is needed for the vector column. The database column `embedding vector(1024)` can remain as-is. The key architectural change is: wiki-store.ts must accept the embedding model name as a parameter instead of hardcoding `"voyage-code-3"`, and the retrieval pipeline must use a wiki-specific embedding provider for query embedding while all other corpora continue using the shared `voyage-code-3` provider.

**Primary recommendation:** Create a contextualized embedding provider that wraps `client.contextualizedEmbed()`, parameterize wiki-store.ts to accept model name, create a backfill script that re-embeds all wiki pages with context, and route wiki queries through the new provider in the retrieval pipeline.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Contextualization strategy:** Use Voyage's contextualized embedding API for wiki document embeddings. Full page text as context for each wiki chunk (no truncation, no cost cap -- quality over cost). Query embeddings for wiki searches also use contextualization -- pass PR diff or conversation context as the query context. Asymmetry: document context = full page text; query context = PR diff / conversation / triggering context from the retrieval pipeline.
- **Migration cutover:** Offline swap approach: run backfill script to re-embed all wiki pages, then flip the model config. Wiki search may return mixed/stale results during backfill window -- acceptable. Overwrite embeddings in place (no shadow column, no backup of old embeddings). Success criterion: zero rows with voyage-code-3 in wiki_pages after backfill completes.
- **Validation approach:** Reusable embedding comparison benchmark script in scripts/ (not one-time -- kept for future model evaluations). Output: console table for quick review + JSON file for detailed analysis. Runs N queries against old vs new embeddings, shows top results and distance scores side by side.
- **Dimension configuration:** Use voyage-context-3's native output dimensions (not forced to 1024). If native dimension is <= 1024: ALTER TABLE wiki_pages to match native dim. If native dimension is > 1024: stay at 1024 using outputDimension parameter.

### Claude's Discretion
- Backfill script mechanics (sequential with delay vs batch with checkpointing, rate limit handling, progress tracking)
- Eval query set composition for the comparison benchmark
- Exact plumbing for passing PR diff/conversation context into wiki query embedding calls

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EMBED-01 | Wiki corpus re-embedded atomically with voyage-context-3 (all pages, not incremental) | Backfill script using `contextualizedEmbed()` API. Existing `wiki-backfill.ts` pattern provides resume/checkpoint infrastructure. Rate limits: 1000 inputs, 120K tokens, 16K chunks per request. |
| EMBED-02 | Per-corpus embedding model selection -- wiki uses voyage-context-3, all other corpora stay on voyage-code-3 | Create two providers in `src/index.ts`: shared `voyage-code-3` provider (existing) + wiki-specific `voyage-context-3` provider. Pass wiki provider to wiki-store, wiki-sync, and wiki-retrieval. |
| EMBED-03 | Wiki store parameterized to accept embedding model name instead of hardcoding voyage-code-3 | `wiki-store.ts` lines 87 and 131 hardcode `"voyage-code-3"`. Parameterize via `opts.embeddingModel` or read from the provider's `.model` property. |
| EMBED-04 | Retrieval pipeline uses correct model per corpus for query embedding | `retrieval.ts` line 441-448 passes the single shared `embeddingProvider` to `searchWikiPages()`. Needs a separate `wikiEmbeddingProvider` parameter in `createRetriever()` deps. `wiki-retrieval.ts` already accepts `embeddingProvider` as a parameter -- just needs the correct one injected. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| voyageai | ^0.1.0 | Voyage AI TypeScript SDK -- `embed()` and `contextualizedEmbed()` | Already installed. SDK provides typed `contextualizedEmbed()` method with `ContextualizedEmbedRequest` / `ContextualizedEmbedResponse` types. |
| postgres (via `src/db/client.ts`) | existing | PostgreSQL with pgvector | Already in use. `vector(1024)` column type with HNSW index. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | existing | Structured logging | All embedding operations log with fail-open semantics |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `contextualizedEmbed()` for queries | Regular `embed()` with voyage-context-3 | User decision: use contextualization for both document AND query embeddings. More expensive but higher quality retrieval. |

**Installation:**
No new packages needed. `voyageai@^0.1.0` already has `contextualizedEmbed()`.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── knowledge/
│   ├── embeddings.ts           # Add createContextualizedEmbeddingProvider()
│   ├── wiki-store.ts           # Parameterize embedding model name
│   ├── wiki-retrieval.ts       # Already accepts embeddingProvider param
│   ├── wiki-sync.ts            # Already accepts embeddingProvider param
│   ├── wiki-backfill.ts        # Already accepts embeddingProvider param
│   ├── retrieval.ts            # Add wikiEmbeddingProvider to deps
│   └── types.ts                # May need ContextualizedEmbeddingProvider type
├── index.ts                    # Create two providers, wire wiki provider
scripts/
├── wiki-embedding-backfill.ts  # New: re-embed all wiki pages with voyage-context-3
└── embedding-comparison.ts     # New: benchmark old vs new embeddings
```

### Pattern 1: Contextualized Embedding Provider
**What:** A new embedding provider that uses `client.contextualizedEmbed()` instead of `client.embed()`
**When to use:** For wiki document and query embeddings where document context improves retrieval
**Key difference:** `contextualizedEmbed()` takes `inputs: string[][]` where each inner array is chunks from the same document. For single-chunk embedding (queries), wrap as `[["query_text"]]`. For document chunks, pass all chunks of a page as one inner array: `[["chunk1", "chunk2", ...]]`.

```typescript
// Source: node_modules/voyageai/api/client/requests/ContextualizedEmbedRequest.d.ts
// SDK method signature:
client.contextualizedEmbed({
  inputs: string[][],      // [[chunk1, chunk2, ...], [doc2_chunk1, ...]]
  model: "voyage-context-3",
  inputType: "document" | "query",
  outputDimension: 1024,   // 256, 512, 1024 (default), 2048
});

// Response structure:
// response.data[docIndex].data[chunkIndex].embedding: number[]
```

### Pattern 2: Per-Corpus Provider Injection
**What:** Create separate embedding providers for different corpora
**When to use:** When different corpora need different models
**Example:**
```typescript
// In src/index.ts -- create two providers
const codeEmbeddingProvider = createEmbeddingProvider({
  apiKey: voyageApiKey,
  model: "voyage-code-3",
  dimensions: 1024,
  logger,
});

const wikiEmbeddingProvider = createContextualizedEmbeddingProvider({
  apiKey: voyageApiKey,
  model: "voyage-context-3",
  dimensions: 1024,  // native default, same as current
  logger,
});

// Pass wiki provider where needed
const retriever = createRetriever({
  embeddingProvider: codeEmbeddingProvider,       // default for code/reviews/issues/snippets
  wikiEmbeddingProvider: wikiEmbeddingProvider,   // wiki-specific
  // ...
});
```

### Pattern 3: Wiki Store Parameterization
**What:** Pass embedding model name to wiki-store instead of hardcoding
**When to use:** When writing/replacing wiki chunks
**Example:**
```typescript
// Current (hardcoded):
const embeddingModel = chunk.embedding ? "voyage-code-3" : null;

// After (parameterized):
const embeddingModel = chunk.embedding ? opts.embeddingModel : null;
// OR read from provider:
const embeddingModel = chunk.embedding ? embeddingProvider.model : null;
```

### Anti-Patterns to Avoid
- **Mixing embedding models in vector search:** Never query a voyage-context-3 embedding column with a voyage-code-3 query vector. The models produce incompatible vector spaces. The retrieval pipeline MUST use the same model for query embedding as was used for document embedding.
- **Sending all chunks as separate documents:** `contextualizedEmbed()` expects `[[chunk1, chunk2, ...]]` where all chunks in an inner array share context. Sending `[["chunk1"], ["chunk2"]]` treats them as separate documents and loses the context benefit.
- **Blocking startup on backfill:** The backfill should be a standalone script, not part of server startup.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Contextualized embeddings | Custom context-prepending to regular `embed()` | `client.contextualizedEmbed()` | Voyage's API handles context fusion at the model level, far better than string concatenation |
| Rate limiting | Custom token counting + delay logic | SDK built-in retries (`maxRetries: 2`) + simple sequential delay | SDK handles 429 responses; backfill just needs a delay between pages |
| Vector dimension matching | Manual dimension validation | pgvector `vector(1024)` column constraint | PostgreSQL rejects mismatched dimensions at insert time |

**Key insight:** The Voyage AI SDK already has the `contextualizedEmbed()` method with proper types. The main work is plumbing, not algorithm implementation.

## Common Pitfalls

### Pitfall 1: Dimension Mismatch After Migration
**What goes wrong:** If voyage-context-3 is configured with different outputDimension than the existing column, inserts fail.
**Why it happens:** The schema has `embedding vector(1024)` and the HNSW index is built for 1024-dim vectors.
**How to avoid:** voyage-context-3 defaults to 1024 dimensions -- same as current. User decision says "use native dimensions" and "if native <= 1024, ALTER TABLE." Since native IS 1024, no ALTER is needed. Explicitly pass `outputDimension: 1024` to be safe.
**Warning signs:** Insert failures with "expected 1024 dimensions, not X" errors.

### Pitfall 2: Context Window Token Limits
**What goes wrong:** `contextualizedEmbed()` has a 120K total token limit across all inputs and 32K context per model. Large wiki pages with many chunks could exceed limits.
**Why it happens:** User decision is "full page text as context, no truncation." Some kodi.wiki pages are very long.
**How to avoid:** For the backfill, send one page at a time: `inputs: [[chunk1, chunk2, ...chunkN]]`. If a single page exceeds 32K tokens, the SDK will return an error -- handle gracefully with fail-open (log warning, skip page or fall back to regular embed).
**Warning signs:** 400 errors from Voyage API about token limits.

### Pitfall 3: Mixed Embeddings During Backfill Window
**What goes wrong:** During the backfill, some rows have voyage-code-3 embeddings and others have voyage-context-3. Vector search returns mixed results with degraded quality.
**Why it happens:** Backfill overwrites in-place and runs sequentially.
**How to avoid:** User explicitly accepted this: "Wiki search may return mixed/stale results during backfill window -- acceptable." Mark rows with the correct `embedding_model` value so you can verify completeness. Success criterion: zero rows with embedding_model = 'voyage-code-3' after backfill.
**Warning signs:** `SELECT COUNT(*) FROM wiki_pages WHERE embedding_model = 'voyage-code-3' AND deleted = false` returning > 0 after backfill.

### Pitfall 4: Query Context Plumbing Complexity
**What goes wrong:** The user wants query embeddings to also use contextualization -- passing PR diff or conversation as context alongside the search query.
**Why it happens:** `searchWikiPages()` currently takes a simple string query. Contextualized query embedding needs additional context.
**How to avoid:** The contextualized embedding provider's `generate()` method for queries can accept context as part of the input. For queries, wrap as `[["query_text"]]` (single-element context group). For richer context, the provider could accept `[[context, query_text]]`. Design the provider interface to accept optional context.
**Warning signs:** Query embeddings that don't leverage context, reducing retrieval quality improvement.

### Pitfall 5: HNSW Index Rebuild
**What goes wrong:** After changing embeddings for all rows, the HNSW index may become suboptimal because it was built with the old embedding distribution.
**Why it happens:** HNSW indexes are built incrementally; bulk-replacing vectors can leave the index in a non-ideal state.
**How to avoid:** After backfill completes, run `REINDEX INDEX idx_wiki_pages_embedding_hnsw;` to rebuild. This is a blocking operation but wiki_pages is not huge.
**Warning signs:** Search quality lower than expected despite correct embeddings.

## Code Examples

### Creating a Contextualized Embedding Provider
```typescript
// Source: node_modules/voyageai/Client.d.ts, node_modules/voyageai/api/client/requests/ContextualizedEmbedRequest.d.ts
import { VoyageAIClient, VoyageAIError } from "voyageai";

export function createContextualizedEmbeddingProvider(opts: {
  apiKey: string;
  model: string;  // "voyage-context-3"
  dimensions: number;
  logger: Logger;
}): EmbeddingProvider {
  const { apiKey, model, dimensions, logger } = opts;
  const client = new VoyageAIClient({ apiKey });

  return {
    async generate(text: string, inputType: "document" | "query"): Promise<EmbeddingResult> {
      try {
        const response = await client.contextualizedEmbed(
          {
            inputs: [[text]],  // single chunk, single document
            model,
            inputType,
            outputDimension: dimensions,
          },
          { timeoutInSeconds: 10, maxRetries: 2 },
        );

        const embedding = response.data?.[0]?.data?.[0]?.embedding;
        if (!embedding) {
          logger.warn({ model }, "Contextualized embedding response missing data (fail-open)");
          return null;
        }

        return {
          embedding: new Float32Array(embedding),
          model,
          dimensions,
        };
      } catch (err: unknown) {
        if (err instanceof VoyageAIError) {
          logger.warn(
            { statusCode: err.statusCode, message: err.message },
            "Voyage AI contextualized embedding failed (fail-open)",
          );
        } else {
          logger.warn({ err }, "Contextualized embedding failed (fail-open)");
        }
        return null;
      }
    },
    get model() { return model; },
    get dimensions() { return dimensions; },
  };
}
```

### Batch Contextualized Embedding for Backfill
```typescript
// For backfill: embed all chunks of a page together for maximum context
async function embedPageChunks(
  client: VoyageAIClient,
  chunks: WikiPageChunk[],
  model: string,
  dimensions: number,
): Promise<Map<number, Float32Array>> {
  const chunkTexts = chunks.map(c => c.chunkText);
  // All chunks in one inner array = one document with shared context
  const response = await client.contextualizedEmbed(
    {
      inputs: [chunkTexts],
      model,
      inputType: "document",
      outputDimension: dimensions,
    },
    { timeoutInSeconds: 30, maxRetries: 2 },
  );

  const result = new Map<number, Float32Array>();
  const docData = response.data?.[0]?.data;
  if (docData) {
    for (const item of docData) {
      if (item.embedding && item.index !== undefined) {
        result.set(item.index, new Float32Array(item.embedding));
      }
    }
  }
  return result;
}
```

### Wiki Store Parameterization
```typescript
// wiki-store.ts: accept embeddingModel as parameter
export function createWikiPageStore(opts: {
  sql: Sql;
  logger: Logger;
  embeddingModel?: string;  // new parameter, defaults to provider model
}): WikiPageStore {
  const { sql, logger, embeddingModel } = opts;

  // In writeChunks and replacePageChunks:
  const model = chunk.embedding ? (embeddingModel ?? "voyage-code-3") : null;
}
```

### Retriever with Per-Corpus Provider
```typescript
// retrieval.ts: add optional wikiEmbeddingProvider
export function createRetriever(deps: {
  embeddingProvider: EmbeddingProvider;
  wikiEmbeddingProvider?: EmbeddingProvider;  // new
  // ... existing deps
}): { retrieve: (opts: RetrieveOptions) => Promise<RetrieveResult | null> } {
  // In wiki search call:
  const wikiProvider = deps.wikiEmbeddingProvider ?? deps.embeddingProvider;
  // Pass wikiProvider to searchWikiPages instead of deps.embeddingProvider
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Standard `embed()` for all text | `contextualizedEmbed()` for document chunks | July 2025 (voyage-context-3 launch) | Chunks embedded with document-level context, significantly improving retrieval for fragmented content |
| Single embedding model for all corpora | Per-corpus model selection | Current migration | Wiki gets specialized model while code/reviews stay on code-optimized model |

**Deprecated/outdated:**
- voyage-code-3 for wiki content: Wiki pages are natural language documentation, not code. `voyage-context-3` is designed for general-purpose and multilingual content retrieval, making it a better fit than the code-specialized model.

## Open Questions

1. **Token count for wiki corpus**
   - What we know: kodi.wiki pages are chunked and stored in wiki_pages table. The backfill processes all pages sequentially.
   - What's unclear: Total token count across all wiki chunks -- needed to estimate backfill cost ($0.18/1M tokens, first 200M free).
   - Recommendation: Add a pre-flight check to the backfill script that counts total tokens before proceeding: `SELECT SUM(token_count) FROM wiki_pages WHERE deleted = false`.

2. **Query context availability in retrieval pipeline**
   - What we know: User wants query embeddings to use contextualization with PR diff / conversation context. `searchWikiPages()` in `wiki-retrieval.ts` currently takes a simple string query.
   - What's unclear: How to thread PR diff or conversation context through the retrieval pipeline to the wiki embedding call. The `RetrieveOptions` type has `queries: string[]` but no context field.
   - Recommendation: Add optional `queryContext?: string` to `RetrieveOptions`. When present, the wiki embedding provider wraps query as `[[queryContext, query]]` for contextualized embedding. When absent, falls back to `[[query]]`.

3. **HNSW index rebuild timing**
   - What we know: After bulk-replacing all wiki embeddings, the HNSW index should be rebuilt for optimal search quality.
   - What's unclear: Whether the rebuild should be part of the backfill script or a separate manual step. Index rebuild is a blocking DDL operation.
   - Recommendation: Log a reminder at backfill completion. Include `REINDEX` as a documented post-migration step.

## Sources

### Primary (HIGH confidence)
- `node_modules/voyageai/Client.d.ts` - Verified `contextualizedEmbed()` method exists with typed request/response
- `node_modules/voyageai/api/client/requests/ContextualizedEmbedRequest.d.ts` - Verified inputs format: `string[][]`, outputDimension options, inputType
- `node_modules/voyageai/api/types/ContextualizedEmbedResponse*.d.ts` - Verified response structure: `data[docIdx].data[chunkIdx].embedding`
- `src/knowledge/embeddings.ts` - Current `createEmbeddingProvider()` implementation using `client.embed()`
- `src/knowledge/wiki-store.ts` lines 87, 131 - Hardcoded `"voyage-code-3"` confirmed
- `src/knowledge/retrieval.ts` lines 440-448 - Wiki search using shared `embeddingProvider` confirmed
- `src/db/migrations/006-wiki-pages.sql` - Schema: `embedding vector(1024)` confirmed

### Secondary (MEDIUM confidence)
- [Voyage AI Contextualized Embeddings Docs](https://docs.voyageai.com/docs/contextualized-chunk-embeddings) - API details, rate limits (1000 inputs, 120K tokens, 16K chunks per request)
- [Voyage AI Embeddings Docs](https://docs.voyageai.com/docs/embeddings) - Model specs: voyage-context-3 supports 256/512/1024(default)/2048 dimensions
- [Voyage AI Pricing](https://docs.voyageai.com/docs/pricing) - $0.18/1M tokens, first 200M free

### Tertiary (LOW confidence)
- [pgvector/pgvector#183](https://github.com/pgvector/pgvector/issues/183) - ALTER TABLE to change vector dimensions is possible but expensive; not needed here since native dim is 1024

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - SDK already installed, `contextualizedEmbed()` verified in TypeScript declarations
- Architecture: HIGH - All integration points identified in codebase, patterns clear from existing code
- Pitfalls: HIGH - Token limits, dimension constraints, HNSW rebuild are well-documented concerns

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- Voyage AI SDK interface unlikely to change within 30 days)
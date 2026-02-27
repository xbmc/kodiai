# Phase 109: Issue Corpus Retrieval Integration - Research

**Researched:** 2026-02-27
**Domain:** Cross-corpus retrieval pipeline, hybrid search, issue corpus integration
**Confidence:** HIGH

## Summary

The existing retrieval architecture in `src/knowledge/retrieval.ts` follows a well-established pattern: each corpus has a dedicated store, a search module (vector + BM25), a normalization function to `UnifiedRetrievalChunk`, and integration into the parallel fan-out in `createRetriever()`. Adding the issue corpus follows the exact same pattern used for wiki, review_comment, code, and snippet corpora.

The `IssueStore` from phase 103/106 already exposes both `searchByEmbedding()` and `searchByFullText()` methods with the correct signatures. The issue comment store also has `searchCommentsByEmbedding()`. The work is primarily wiring: creating an `issue-retrieval.ts` search module (following `wiki-retrieval.ts` pattern), adding an `issueMatchToUnified()` normalizer, extending `SourceType` to include `"issue"`, adding the issue search to the parallel fan-out, and updating `SOURCE_WEIGHTS`.

**Primary recommendation:** Follow the exact structural pattern of the wiki corpus integration -- create `issue-retrieval.ts` with `searchIssues()`, add `issueMatchToUnified()` to `retrieval.ts`, extend `SourceType`, wire into the fan-out and RRF pipeline.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
| Area | Decision |
|------|----------|
| Search strategy | Hybrid (vector + BM25) |
| Weight: pr_review | 0.8 |
| Weight: issue | 1.5 |
| Weight: question | 1.2 |
| Weight: slack | 1.0 |
| Citation format | `[issue: #N] Title (status)` |
| Chunk strategy | Reuse phase 106 chunks |
| New SourceType | `"issue"` |

### Claude's Discretion
None explicitly marked -- all decisions are locked.

### Deferred Ideas (OUT OF SCOPE)
None identified -- phase scope is well-bounded.
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres (porsager) | existing | SQL client for pgvector queries | Already used by all stores |
| pgvector | existing | HNSW vector similarity search | Already indexed on issues table |
| voyage-code-3 | existing | Embedding model | Used by all corpora |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | existing | Structured logging | All search/retrieval operations |

No new dependencies required. This phase exclusively wires existing infrastructure.

## Architecture Patterns

### Existing Retrieval Pipeline Structure
```
src/knowledge/
  retrieval.ts             # createRetriever() - main pipeline orchestrator
  cross-corpus-rrf.ts      # SourceType, UnifiedRetrievalChunk, crossCorpusRRF()
  hybrid-search.ts         # hybridSearchMerge() - per-corpus RRF
  dedup.ts                 # deduplicateChunks() - within/cross corpus
  wiki-retrieval.ts        # searchWikiPages() -> WikiKnowledgeMatch
  review-comment-retrieval.ts  # searchReviewComments() -> ReviewCommentMatch
  code-snippet-retrieval.ts    # searchCodeSnippets() -> CodeSnippetMatch
  issue-store.ts           # IssueStore with searchByEmbedding + searchByFullText
  issue-types.ts           # IssueStore interface, IssueSearchResult
```

### Pattern 1: Corpus Search Module (follow wiki-retrieval.ts)
**What:** A dedicated `searchIssues()` function that wraps store calls with fail-open semantics.
**When to use:** Every corpus gets one of these.
**Example:**
```typescript
// Source: wiki-retrieval.ts pattern
export type IssueKnowledgeMatch = {
  chunkText: string;
  distance: number;
  repo: string;
  issueNumber: number;
  title: string;
  state: string;
  authorLogin: string;
  githubCreatedAt: string;
  source: "issue";
};

export async function searchIssues(opts: {
  store: IssueStore;
  embeddingProvider: EmbeddingProvider;
  query: string;
  repo: string;
  topK: number;
  distanceThreshold?: number;
  logger: Logger;
}): Promise<IssueKnowledgeMatch[]> {
  const embedResult = await opts.embeddingProvider.generate(opts.query, "query");
  if (!embedResult) return [];

  const results = await opts.store.searchByEmbedding({
    queryEmbedding: embedResult.embedding,
    repo: opts.repo,
    topK: opts.topK,
  });

  return results
    .filter((r) => r.distance <= (opts.distanceThreshold ?? 0.7))
    .map((r) => ({
      chunkText: `#${r.record.issueNumber} ${r.record.title}\n\n${(r.record.body ?? "").slice(0, 2000)}`,
      distance: r.distance,
      repo: r.record.repo,
      issueNumber: r.record.issueNumber,
      title: r.record.title,
      state: r.record.state,
      authorLogin: r.record.authorLogin,
      githubCreatedAt: r.record.githubCreatedAt,
      source: "issue" as const,
    }));
}
```

### Pattern 2: Normalization to UnifiedRetrievalChunk (follow reviewMatchToUnified)
**What:** Convert corpus-specific match types to the unified chunk format.
**When to use:** Before entering the RRF pipeline.
**Example:**
```typescript
// Source: retrieval.ts lines 186-206 (reviewMatchToUnified pattern)
function issueMatchToUnified(match: IssueKnowledgeMatch, fullRepo: string): UnifiedRetrievalChunk {
  return {
    id: `issue:${fullRepo}:${match.issueNumber}:${match.distance}`,
    text: match.chunkText,
    source: "issue",
    sourceLabel: `[issue: #${match.issueNumber}] ${match.title} (${match.state})`,
    sourceUrl: `https://github.com/${fullRepo}/issues/${match.issueNumber}`,
    vectorDistance: match.distance,
    rrfScore: 0,
    createdAt: match.githubCreatedAt,
    metadata: {
      issueNumber: match.issueNumber,
      title: match.title,
      state: match.state,
      authorLogin: match.authorLogin,
    },
  };
}
```

### Pattern 3: Fan-out Integration in createRetriever
**What:** Add issue vector + BM25 searches to the existing `Promise.allSettled()` array.
**When to use:** The main retrieve() function in retrieval.ts.
**Key details:**
- Current fan-out has 7 parallel searches (lines 369-455)
- Add 2 more: issue vector search + issue BM25 full-text search
- Total becomes 9 parallel searches
- Follow exact same fail-open pattern (Promise.allSettled)

### Pattern 4: createRetriever Dependency Injection
**What:** Add `issueStore?: IssueStore` to the `createRetriever` deps parameter.
**When to use:** At retriever construction time.
**Key details:**
- Currently accepts: embeddingProvider, isolationLayer, config, reviewCommentStore?, wikiPageStore?, memoryStore?, codeSnippetStore?
- Add `issueStore?: IssueStore` (optional, fail-open like others)
- Wire in `src/index.ts` at line 234 where createRetriever is called

### Pattern 5: SourceType Extension
**What:** Add `"issue"` to the SourceType union in cross-corpus-rrf.ts.
**Current definition (line 9):**
```typescript
export type SourceType = "code" | "review_comment" | "wiki" | "snippet";
```
**New:**
```typescript
export type SourceType = "code" | "review_comment" | "wiki" | "snippet" | "issue";
```

### Pattern 6: SOURCE_WEIGHTS Update
**Current definition (retrieval.ts lines 98-103):**
```typescript
const SOURCE_WEIGHTS: Record<TriggerType, Record<string, number>> = {
  pr_review: { code: 1.2, review_comment: 1.2, wiki: 1.0, snippet: 1.1 },
  issue: { code: 1.0, review_comment: 1.0, wiki: 1.2, snippet: 0.8 },
  question: { code: 1.0, review_comment: 1.0, wiki: 1.2, snippet: 0.8 },
  slack: { code: 1.0, review_comment: 1.0, wiki: 1.0, snippet: 1.0 },
};
```
**New (per CONTEXT.md locked weights):**
```typescript
const SOURCE_WEIGHTS: Record<TriggerType, Record<string, number>> = {
  pr_review: { code: 1.2, review_comment: 1.2, wiki: 1.0, snippet: 1.1, issue: 0.8 },
  issue: { code: 1.0, review_comment: 1.0, wiki: 1.2, snippet: 0.8, issue: 1.5 },
  question: { code: 1.0, review_comment: 1.0, wiki: 1.2, snippet: 0.8, issue: 1.2 },
  slack: { code: 1.0, review_comment: 1.0, wiki: 1.0, snippet: 1.0, issue: 1.0 },
};
```

### Anti-Patterns to Avoid
- **Separate retrieval path for issues:** Do NOT create a parallel pipeline. Issues MUST go through the same crossCorpusRRF as all other sources.
- **Embedding issues at query time:** Issue embeddings already exist from phase 106 ingestion. Only embed the query, not the issues.
- **Skipping hybrid search for issues:** The IssueStore has both `searchByEmbedding` and `searchByFullText`. Use both via `hybridSearchMerge()`, matching wiki/review_comment patterns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hybrid merge | Custom scoring | `hybridSearchMerge()` | RRF is already implemented and tested |
| Cross-corpus ranking | Custom ranking | `crossCorpusRRF()` | Handles recency boost, source merging |
| Deduplication | Custom dedup | `deduplicateChunks()` | Jaccard-based with alternate source annotation |
| Embedding generation | Direct API calls | `embeddingProvider.generate()` | Handles caching, model config |
| Context assembly | Custom formatting | `assembleContextWindow()` | Respects token budget, source labels |

**Key insight:** The entire unified retrieval pipeline is already built. This phase is strictly about adding another corpus to the existing machine.

## Common Pitfalls

### Pitfall 1: Forgetting to Wire BM25 for Issues
**What goes wrong:** Only adding vector search, missing BM25 full-text search.
**Why it happens:** The IssueStore exposes `searchByFullText()` but it needs to be called separately and merged via `hybridSearchMerge()`.
**How to avoid:** Follow the exact wiki pattern: vector search in fan-out slot + BM25 in fan-out slot + `hybridSearchMerge()` after results settle.
**Warning signs:** Issue results only appear for semantic matches, not keyword/number matches.

### Pitfall 2: Missing the BM25-to-Unified Normalization
**What goes wrong:** BM25 results are raw `IssueSearchResult[]` objects; they need conversion to `UnifiedRetrievalChunk` before `hybridSearchMerge`.
**Why it happens:** The wiki/review BM25 normalization in retrieval.ts (lines 552-618) is verbose and handles `record` extraction carefully.
**How to avoid:** Issue BM25 results already return `IssueSearchResult` with a `record` field and `distance`. Map them through `issueMatchToUnified()`.

### Pitfall 3: Not Updating assembleContextWindow Missing Corpora Check
**What goes wrong:** The `assembleContextWindow` function (line 311) checks for missing "code", "review comment", "wiki" sources. It does NOT currently check for "issue". This is cosmetic but should be updated for consistency.
**How to avoid:** Add `"issue"` to the missing corpora check if desired, or leave it (minor).

### Pitfall 4: Not Updating getChunkLanguage for Issue Source
**What goes wrong:** The `getChunkLanguage()` function (lines 141-170) handles code, wiki, review_comment, snippet but not "issue". Issues are language-agnostic so this returns null (correct default behavior via the fallback at line 169).
**How to avoid:** No action needed -- the fallback `return null` handles it correctly. Issues don't have language affinity.

### Pitfall 5: Forgetting to Update index.ts Wiring
**What goes wrong:** `issueStore` exists in `src/index.ts` line 204 but is NOT currently passed to `createRetriever()` (line 216-236).
**How to avoid:** Add `issueStore` to the `createRetriever()` call in `src/index.ts`.

### Pitfall 6: Issue Comment Search Not Included
**What goes wrong:** Only searching issue titles/bodies, missing comment corpus.
**Why it happens:** `IssueStore.searchCommentsByEmbedding()` is a separate method from `searchByEmbedding()`.
**How to avoid:** Per CONTEXT.md, comment chunks are separate. Include comment vector search as an additional fan-out slot, or merge comment results with issue results before hybrid merge.

## Code Examples

### Complete Issue Search Module (issue-retrieval.ts)
```typescript
// Source: derived from wiki-retrieval.ts + review-comment-retrieval.ts patterns
import type { Logger } from "pino";
import type { EmbeddingProvider } from "./types.ts";
import type { IssueStore, IssueSearchResult } from "./issue-types.ts";

export type IssueKnowledgeMatch = {
  chunkText: string;
  distance: number;
  repo: string;
  issueNumber: number;
  title: string;
  state: string;
  authorLogin: string;
  githubCreatedAt: string;
  source: "issue";
};

const DEFAULT_DISTANCE_THRESHOLD = 0.7;

export async function searchIssues(opts: {
  store: IssueStore;
  embeddingProvider: EmbeddingProvider;
  query: string;
  repo: string;
  topK: number;
  distanceThreshold?: number;
  logger: Logger;
}): Promise<IssueKnowledgeMatch[]> {
  const { store, embeddingProvider, query, repo, topK,
    distanceThreshold = DEFAULT_DISTANCE_THRESHOLD, logger } = opts;

  const embedResult = await embeddingProvider.generate(query, "query");
  if (!embedResult) {
    logger.debug("Issue search skipped: embedding generation returned null");
    return [];
  }

  const searchResults: IssueSearchResult[] = await store.searchByEmbedding({
    queryEmbedding: embedResult.embedding,
    repo,
    topK,
  });

  return searchResults
    .filter((r) => r.distance <= distanceThreshold)
    .map((r) => ({
      chunkText: `#${r.record.issueNumber} ${r.record.title}\n\n${(r.record.body ?? "").slice(0, 2000)}`,
      distance: r.distance,
      repo: r.record.repo,
      issueNumber: r.record.issueNumber,
      title: r.record.title,
      state: r.record.state,
      authorLogin: r.record.authorLogin,
      githubCreatedAt: r.record.githubCreatedAt,
      source: "issue" as const,
    }));
}
```

### Normalization Function (add to retrieval.ts)
```typescript
// Source: follows reviewMatchToUnified pattern at retrieval.ts:186
function issueMatchToUnified(match: IssueKnowledgeMatch, repo: string): UnifiedRetrievalChunk {
  return {
    id: `issue:${repo}:${match.issueNumber}:${match.distance}`,
    text: match.chunkText,
    source: "issue",
    sourceLabel: `[issue: #${match.issueNumber}] ${match.title} (${match.state})`,
    sourceUrl: `https://github.com/${repo}/issues/${match.issueNumber}`,
    vectorDistance: match.distance,
    rrfScore: 0,
    createdAt: match.githubCreatedAt,
    metadata: {
      issueNumber: match.issueNumber,
      title: match.title,
      state: match.state,
      authorLogin: match.authorLogin,
    },
  };
}
```

### Fan-out Addition (in retrieve() function)
```typescript
// Add to Promise.allSettled array (after snippet vector search):
// (h) Issue vector search
deps.issueStore
  ? searchIssues({
      store: deps.issueStore,
      embeddingProvider: deps.embeddingProvider,
      query: intentQuery,
      repo: opts.repo,
      topK: 5,
      logger: opts.logger,
    })
  : Promise.resolve([] as IssueKnowledgeMatch[]),
// (i) Issue BM25 full-text search
deps.issueStore?.searchByFullText
  ? deps.issueStore.searchByFullText({
      query: intentQuery,
      repo: opts.repo,
      topK: 5,
    })
  : Promise.resolve([]),
```

### Hybrid Merge for Issues (after fan-out settles)
```typescript
// Issue: merge vector + BM25 (follows wiki pattern)
const issueBm25 = issueFullTextResult.status === "fulfilled"
  ? issueFullTextResult.value.map((r) =>
      issueMatchToUnified({
        chunkText: `#${r.record.issueNumber} ${r.record.title}\n\n${(r.record.body ?? "").slice(0, 2000)}`,
        distance: r.distance,
        repo: r.record.repo,
        issueNumber: r.record.issueNumber,
        title: r.record.title,
        state: r.record.state,
        authorLogin: r.record.authorLogin,
        githubCreatedAt: r.record.githubCreatedAt,
        source: "issue",
      }, opts.repo)
    )
  : [];

const hybridIssue = hybridSearchMerge({
  vectorResults: issueChunks,
  bm25Results: issueBm25,
  getKey: (c) => c.id,
  k: RRF_K,
});
```

### RRF Source List Addition
```typescript
// Add after dedupedSnippets block:
const dedupedIssues = deduplicateChunks({
  chunks: hybridIssue.map((h) => h.item),
  similarityThreshold: DEDUP_THRESHOLD,
  mode: "within-corpus",
});

if (dedupedIssues.length > 0) {
  sourceLists.push({ source: "issue", items: dedupedIssues });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate search per corpus | Unified cross-corpus RRF pipeline | Phase ~90s | All corpora must go through same pipeline |
| Vector-only search | Hybrid vector + BM25 | Phase ~95s | Both search types needed per corpus |
| Manual citation format | sourceLabel on UnifiedRetrievalChunk | Phase ~95s | Citation format baked into normalizer |

## Integration Touchpoints Checklist

| File | Change | Details |
|------|--------|---------|
| `src/knowledge/cross-corpus-rrf.ts` | Extend SourceType | Add `"issue"` to union |
| `src/knowledge/issue-retrieval.ts` | **New file** | `searchIssues()` + `IssueKnowledgeMatch` type |
| `src/knowledge/retrieval.ts` | Multiple changes | Add issueStore dep, issueMatchToUnified(), fan-out slots, hybrid merge, dedup, RRF source list, SOURCE_WEIGHTS |
| `src/knowledge/index.ts` | Re-exports | Export searchIssues, IssueKnowledgeMatch |
| `src/index.ts` | Wire issueStore | Pass issueStore to createRetriever() call |

## Open Questions

1. **Issue comments as separate search**
   - What we know: IssueStore has `searchCommentsByEmbedding()` but no `searchCommentsByFullText()`. Comments are stored as separate rows.
   - What's unclear: Should issue comments be a separate fan-out slot, or merged with issue body results?
   - Recommendation: Start with issue body search only (vector + BM25). Comment search can be added as a follow-up if issue body results are insufficient. The IssueStore BM25 `search_tsv` is on the issues table (title + body), not comments.

2. **Provenance tracking**
   - What we know: `RetrieveResult.provenance` tracks reviewCommentCount, wikiPageCount, snippetCount but not issueCount.
   - Recommendation: Add `issueCount: number` to provenance for consistency.

## Sources

### Primary (HIGH confidence)
- `src/knowledge/retrieval.ts` - Full retrieval pipeline with all corpus integrations
- `src/knowledge/cross-corpus-rrf.ts` - SourceType definition, UnifiedRetrievalChunk schema
- `src/knowledge/hybrid-search.ts` - RRF hybrid merge implementation
- `src/knowledge/issue-store.ts` - IssueStore with searchByEmbedding + searchByFullText
- `src/knowledge/issue-types.ts` - IssueStore interface definition
- `src/knowledge/wiki-retrieval.ts` - Pattern template for new corpus search module
- `src/knowledge/review-comment-retrieval.ts` - Pattern template for normalization
- `src/knowledge/dedup.ts` - Deduplication with within/cross corpus modes
- `src/knowledge/index.ts` - Module re-exports
- `src/index.ts` - Application wiring, createRetriever call site
- `src/handlers/review.ts` - Review handler retrieval consumer
- `src/handlers/mention.ts` - Mention handler retrieval consumer

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed; all infrastructure exists
- Architecture: HIGH - Exact pattern exists for 4 other corpora; copy-paste with modifications
- Pitfalls: HIGH - Identified from direct code inspection of existing integrations
- Integration points: HIGH - All files and line numbers verified in codebase

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable internal architecture)

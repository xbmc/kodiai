# Architecture Research: Wiki Content Update Pipeline

**Domain:** Wiki content staleness detection, update generation, and issue publishing
**Researched:** 2026-03-02
**Confidence:** HIGH

## System Overview

```
                    v0.25 Wiki Content Update Pipeline
============================================================================

  EXISTING (extend)                    NEW (build)
  -----------------                    -----------

  ┌──────────────────┐                ┌───────────────────────┐
  │ EmbeddingProvider │────migrate───>│ Per-Corpus Model Sel. │
  │ (voyage-code-3)   │               │ wiki: voyage-context-3│
  └──────────────────┘                │ rest: voyage-code-3   │
                                      └───────────┬───────────┘
                                                   │
  ┌──────────────────┐                ┌────────────▼──────────┐
  │ WikiPageStore     │───add cols───>│ wiki_page_popularity  │
  │ (wiki_pages tbl)  │               │ (new table)           │
  └──────────────────┘                └────────────┬──────────┘
                                                   │
  ┌──────────────────┐                ┌────────────▼──────────┐
  │ WikiStaleness     │───enhance────>│ Enhanced Staleness     │
  │ Detector          │               │ + PR/commit grounding  │
  └──────────────────┘                └────────────┬──────────┘
                                                   │
                                      ┌────────────▼──────────┐
  ┌──────────────────┐                │ Update Generator       │
  │ generateWith      │───new task───>│ (section-by-section)   │
  │ Fallback()        │               │ LLM rewrite pipeline   │
  └──────────────────┘                └────────────┬──────────┘
                                                   │
                                      ┌────────────▼──────────┐
  ┌──────────────────┐                │ Issue Publisher         │
  │ Octokit           │───new flow──>│ (xbmc/wiki tracking    │
  │ (GitHub API)      │               │  issue + comments)     │
  └──────────────────┘                └────────────────────────┘
```

## Component Responsibilities

### Modified Components (extend existing code)

| Component | Current Responsibility | Modification | Files Affected |
|-----------|----------------------|--------------|----------------|
| `createEmbeddingProvider()` | Single model (voyage-code-3, 1024d) for all corpora | Add per-corpus model selection; wiki corpus uses voyage-context-3 | `src/knowledge/embeddings.ts`, `src/index.ts` |
| `WikiPageStore` | CRUD + search for wiki_pages | Add popularity-related queries; update `embedding_model` to track which model generated each embedding | `src/knowledge/wiki-store.ts` |
| `wiki-staleness-detector.ts` | Heuristic + LLM two-tier staleness detection | Enhanced analysis: PR diff content as ground truth, not just file-path token overlap | `src/knowledge/wiki-staleness-detector.ts` |
| `TASK_TYPES` | 7 task types for LLM routing | Add `WIKI_UPDATE_SUGGESTION` task type for section rewrite generation | `src/llm/task-types.ts` |
| Database schema | 19 migrations | New migration for wiki_page_popularity table + wiki_pages embedding_model backfill | `src/db/migrations/020-*.sql` |

### New Components (build from scratch)

| Component | Responsibility | Integrates With |
|-----------|---------------|-----------------|
| `wiki-embedding-migrator.ts` | One-shot script: re-embed all wiki_pages chunks with voyage-context-3, update embedding + embedding_model columns | `EmbeddingProvider`, `WikiPageStore`, `sql` |
| `wiki-popularity.ts` | Compute popularity score per page from retrieval citation frequency (page view stats unavailable) | `sql` (query retrieval logs), `WikiPageStore` |
| `wiki-update-generator.ts` | LLM-driven section-by-section rewrite suggestion for stale pages | `generateWithFallback()`, `WikiPageStore`, staleness detector output |
| `wiki-issue-publisher.ts` | Create tracking issue in xbmc/wiki, post per-page update as issue comments | `Octokit`, update generator output |

## Integration Point Analysis

### 1. Embedding Migration (voyage-code-3 to voyage-context-3)

**Integration approach:** Per-corpus model selection, not global replacement.

The current architecture uses a single `EmbeddingProvider` instance created in `src/index.ts` (line 147) with `model: "voyage-code-3"` and `dimensions: 1024`. This provider is injected into all stores and retrieval functions.

**Key finding:** voyage-context-3 supports the same dimension options as voyage-code-3: 2048, 1024 (default), 512, 256. Both default to 1024. This means the HNSW index on wiki_pages (`vector(1024)`) does NOT need rebuilding -- only the embedding values change, not the dimensionality.

**Architecture decision: Two-provider approach.**

```typescript
// src/index.ts -- create two providers
const codeEmbeddingProvider = createEmbeddingProvider({
  apiKey: voyageApiKey,
  model: "voyage-code-3",
  dimensions: 1024,
  logger,
});

const wikiEmbeddingProvider = createEmbeddingProvider({
  apiKey: voyageApiKey,
  model: "voyage-context-3",
  dimensions: 1024,
  logger,
});
```

**Why two providers instead of a lookup map:** The existing `EmbeddingProvider` interface is simple (`generate(text, inputType)`). A registry/map adds complexity for only two models. The `createRetriever()` factory already receives separate stores per corpus -- passing a separate provider per corpus follows the same pattern.

**Migration path:**
1. Create `wikiEmbeddingProvider` alongside existing `codeEmbeddingProvider`
2. Write migration script that iterates all wiki_pages rows, re-embeds with voyage-context-3, updates `embedding` and `embedding_model` columns
3. Update `wiki-sync.ts` and `wiki-backfill.ts` to accept the wiki-specific provider
4. Update `createRetriever()` to pass `wikiEmbeddingProvider` when searching wiki corpus
5. Query-time: queries against wiki use voyage-context-3 for query embedding; queries against other corpora use voyage-code-3

**Critical constraint:** During migration, old voyage-code-3 embeddings and new voyage-context-3 embeddings CANNOT be compared meaningfully in the same vector search. The migration script must be atomic per-page (re-embed all chunks for a page in one transaction) or batch (mark old embeddings stale, re-embed, then unstale).

**Retrieval compatibility:** `searchWikiPages()` in `wiki-retrieval.ts` calls `embeddingProvider.generate(query, "query")` to create the query vector. After migration, this must use `wikiEmbeddingProvider` (voyage-context-3) so query vectors match document vectors. The `createRetriever()` factory needs a second `EmbeddingProvider` parameter for wiki.

### 2. Page Popularity Ranking

**Critical finding: kodi.wiki does NOT have the PageViewInfo extension installed.** Tested directly:
- `kodi.wiki/api.php?action=query&list=mostviewed` returns "Unrecognized value for parameter 'list': mostviewed"
- `kodi.wiki/api.php?action=help&modules=query+pageviews` returns "module 'query' does not have a submodule 'pageviews'"
- `kodi.wiki/api.php?action=query&prop=info` does not include page counters

**Alternative popularity signals available within existing data:**

| Signal | Source | Reliability | Implementation |
|--------|--------|-------------|----------------|
| Retrieval citation frequency | Cross-corpus RRF results + context window assembly | HIGH -- direct measure of "pages users ask about" | Query llm_cost_events or add lightweight citation tracking |
| Wiki page link-in count | MediaWiki API `prop=linkshere` | MEDIUM -- measures internal wiki importance | New API call per page during popularity scan |
| Staleness detector hit count | wiki_staleness_run_state + heuristic pass logs | LOW -- measures code-change correlation, not user interest | Already partially tracked |

**Architecture decision: Citation-frequency as primary popularity signal.**

The system already retrieves wiki pages in every PR review, mention response, and Slack query. The `contextWindow` in `RetrieveResult` contains `[wiki: Page Title]` citations. Counting how often each wiki page appears in retrieval results over time is the most direct measure of "which pages matter to developers."

**Implementation approach:**

```sql
-- New table: wiki_page_popularity
CREATE TABLE wiki_page_popularity (
  page_id INTEGER PRIMARY KEY,
  page_title TEXT NOT NULL,
  citation_count INTEGER NOT NULL DEFAULT 0,
  last_cited_at TIMESTAMPTZ,
  link_in_count INTEGER DEFAULT 0,
  computed_score FLOAT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wiki_popularity_score
  ON wiki_page_popularity (computed_score DESC);
```

Citation tracking: add a lightweight fire-and-forget function after `createRetriever()` returns results. For each wiki chunk in `unifiedResults`, increment `citation_count` on the popularity table. This follows the existing fire-and-forget pattern used by hunk embedding (`src/knowledge/code-snippet-chunker.ts`).

MediaWiki `linkshere` API as supplementary signal: for each page, query `action=query&prop=linkshere&titles=PageTitle&lhlimit=max` to count how many other wiki pages link to it. Run once during the popularity scan, cache in the table.

Combined score formula: `computed_score = (citation_count * 0.7) + (link_in_count * 0.3)` -- weight citation frequency higher because it reflects actual developer usage patterns.

### 3. Enhanced Staleness Analysis

**Current staleness detector limitations:**
- Uses file-path token overlap as heuristic (e.g., "player" in wiki text matches "xbmc/cores/player/..." in changed files)
- LLM evaluation only sees up to 3 chunk excerpts + 10 changed file paths
- No actual diff content -- the LLM cannot determine WHAT changed, only that files with overlapping names changed

**Enhancement: PR/commit grounding.**

The staleness detector already fetches commits via `octokit.repos.getCommit()` which returns file-level diffs. The enhancement adds:

1. **Diff content extraction:** For each affecting commit, extract a summary of actual changes (not just file paths). Use the commit detail's `patch` field (already available from the API response but currently discarded -- only `filename` is kept).

2. **PR association:** For merged PRs, the PR title and description often explain the intent of changes better than raw diffs. Use `octokit.repos.listPullRequestsAssociatedWithCommit()` to link commits to PRs.

3. **Enhanced LLM prompt:** Include diff summaries and PR descriptions in the staleness evaluation prompt, so the LLM can determine not just "something changed" but "specifically X was renamed/removed/added."

**Integration with existing code:**

```
fetchChangedFiles() currently returns: { sha, files: string[], date }
Enhanced version returns:   { sha, files: { path, patch_summary }[], date, prTitle?, prBody? }
```

The `CommitWithFiles` type in `wiki-staleness-detector.ts` (line 73) extends to include optional patch content. The `evaluateWithLlm()` function (line 274) gets richer context.

**Cost control:** Diff patches can be large. Truncate each file's patch to 500 chars. Limit PR body to 300 chars. The LLM_CAP of 20 pages per cycle already bounds total LLM calls.

### 4. LLM Update Generation

**New component: `wiki-update-generator.ts`**

This is the most architecturally significant new piece. It takes stale pages (from the enhanced staleness detector) and generates concrete section-by-section rewrite suggestions.

**Data flow:**

```
Input: Top 20 stale pages (sorted by popularity * staleness confidence)
  |
  v
For each page:
  1. Fetch ALL chunks from wiki_pages (not just 3 excerpts)
  2. Fetch affecting commit diffs + PR context
  3. Build section-by-section prompt
  |
  v
LLM generates per-section updates:
  - "Section X: No changes needed"
  - "Section Y: Replace [old text] with [new text] because [reason]"
  |
  v
Output: UpdateSuggestion[] per page
```

**New task type:**

```typescript
// src/llm/task-types.ts
WIKI_UPDATE_SUGGESTION: "wiki.update-suggestion",
```

Non-agentic task -- uses AI SDK `generateText()` via `generateWithFallback()`. No MCP tools needed (this is pure text generation, not code editing).

**Prompt structure (per page):**

```
System: You are updating wiki documentation for the Kodi project.
You will be given the current wiki page content section by section,
and the code changes that affect this page.

For each section, provide one of:
- NO_CHANGE: Section is still accurate
- UPDATE: The specific text that should change and why

User:
## Wiki Page: {title}
## Section 1: {heading}
{section_content}

## Recent Code Changes
{diff_summaries_with_pr_context}

## Evidence of Staleness
{staleness_explanation_from_detector}
```

**Cost estimate:** At ~2000 tokens input + ~500 tokens output per page, 20 pages = ~50K tokens total. Using Haiku (default for non-agentic tasks) this is approximately $0.05 per run. Acceptable for a manual-trigger one-shot.

### 5. GitHub Issue Publishing

**New component: `wiki-issue-publisher.ts`**

**Workflow:**
1. Create a single tracking issue in `xbmc/wiki` repository: "Wiki Content Update Suggestions (YYYY-MM-DD)"
2. For each of the top 20 stale pages, post an issue comment with the update suggestions
3. Each comment is self-contained: page title, link, section-by-section suggestions

**Integration:**

Uses existing `Octokit` instance (already available in `src/index.ts`). The app needs to be installed on `xbmc/wiki` (or the GitHub App needs access to that repo).

**Comment format per page:**

```markdown
## {page_title}
**Link:** {page_url}
**Staleness confidence:** {confidence}
**Triggered by:** {commit_sha_short} ({pr_title})

### Section: {heading_1}
{suggestion_or_no_change}

### Section: {heading_2}
{suggestion_or_no_change}

---
*Generated by Kodiai wiki update pipeline*
```

**Idempotency:** Use issue title as dedup key. Before creating, search for existing open issue with the same title pattern. If found, close it and create a new one (or append to it).

**GitHub API considerations:**
- Comment body limit: 65,536 characters. Pages with many sections may need splitting across multiple comments.
- Rate limiting: 20 comments posted sequentially with existing Octokit retry logic is well within limits.
- xbmc/wiki repo access: verify the GitHub App installation covers this repo.

## Recommended Build Order

```
Phase 1: Embedding Migration
  ├── Per-corpus embedding provider wiring
  ├── Migration script (re-embed wiki chunks)
  └── Retrieval query-side update (wiki queries use voyage-context-3)

Phase 2: Page Popularity
  ├── wiki_page_popularity table + migration
  ├── Citation tracking (fire-and-forget after retrieval)
  ├── MediaWiki linkshere supplementary signal
  └── Combined popularity scoring

Phase 3: Enhanced Staleness
  ├── Extend CommitWithFiles with patch summaries
  ├── PR association via commit API
  └── Richer LLM evaluation prompt

Phase 4: Update Generation
  ├── New task type: wiki.update-suggestion
  ├── Section-by-section prompt pipeline
  └── UpdateSuggestion output types

Phase 5: Issue Publishing
  ├── Tracking issue creation in xbmc/wiki
  ├── Per-page comment posting
  └── Manual trigger wiring (CLI or endpoint)
```

**Build order rationale:**
- Phase 1 first: embedding migration is independent and benefits ALL wiki retrieval immediately
- Phase 2 before 3: popularity ranking determines WHICH pages to focus staleness analysis on
- Phase 3 before 4: enhanced staleness output is input to update generation prompts
- Phase 4 before 5: you need generated suggestions before you can publish them
- Phase 5 last: pure output/delivery, depends on everything upstream

## Architectural Patterns

### Pattern 1: Per-Corpus Provider Injection

**What:** Instead of a single global EmbeddingProvider, inject corpus-specific providers where needed.
**When to use:** When different corpora benefit from different embedding models (wiki = prose-optimized, code = code-optimized).
**Trade-offs:** Slightly more wiring in `src/index.ts` and `createRetriever()`, but preserves the simple `EmbeddingProvider` interface. No registry/factory overhead.

```typescript
// In createRetriever factory
export function createRetriever(deps: {
  embeddingProvider: EmbeddingProvider;      // default (voyage-code-3)
  wikiEmbeddingProvider?: EmbeddingProvider; // wiki-specific (voyage-context-3)
  // ... other deps
})
```

### Pattern 2: Fire-and-Forget Tracking

**What:** Increment citation counts asynchronously after retrieval completes, without blocking the response.
**When to use:** For analytics/tracking that should never impact critical path latency.
**Trade-offs:** Data is eventually consistent (a few citations may be lost on crash). Acceptable for popularity scoring.

Follows existing precedent: hunk embedding in `src/knowledge/code-snippet-chunker.ts` uses the same pattern.

### Pattern 3: Pipeline-as-Script (One-Shot Manual Trigger)

**What:** The full update pipeline (popularity scan -> staleness analysis -> update generation -> issue publishing) runs as a single orchestrated function, triggered manually.
**When to use:** For v0.25 scope (one-shot, top 20 pages). Can be promoted to scheduled job later.
**Trade-offs:** Simpler than a multi-step job queue. No retry/resume on partial failure -- acceptable for manual trigger.

```typescript
// Entry point
export async function runWikiUpdatePipeline(opts: {
  sql: Sql;
  octokit: Octokit;
  wikiStore: WikiPageStore;
  wikiEmbeddingProvider: EmbeddingProvider;
  taskRouter: TaskRouter;
  costTracker?: CostTracker;
  logger: Logger;
  targetRepo: string;     // "xbmc/wiki"
  topN: number;           // 20
}): Promise<WikiUpdatePipelineResult>
```

## Data Flow

### Full Pipeline Flow

```
[Manual trigger (CLI/endpoint)]
    |
    v
[Popularity Scanner]
    | Queries: wiki_page_popularity + wiki_pages
    | Output: ranked page list (top N by combined score)
    |
    v
[Enhanced Staleness Detector]
    | Input: top N popular pages
    | Queries: GitHub commits API (with diffs), PR associations
    | Output: StalePage[] with enhanced evidence
    |
    v
[Update Generator]
    | Input: stale pages + full wiki content + diff evidence
    | Calls: generateWithFallback() per page
    | Output: UpdateSuggestion[] per page
    |
    v
[Issue Publisher]
    | Input: page suggestions
    | Calls: Octokit issues.create() + issues.createComment()
    | Output: issue URL + comment count
    |
    v
[Result summary logged + optional Slack notification]
```

### Embedding Migration Flow (One-Shot)

```
[Migration script]
    |
    |-> Query wiki_pages WHERE embedding_model = 'voyage-code-3'
    |   (batch of 50 at a time)
    |
    |-> For each batch:
    |     1. Generate new embeddings via wikiEmbeddingProvider
    |     2. UPDATE wiki_pages SET embedding = $new, embedding_model = 'voyage-context-3'
    |     3. Rate-limit delay (VoyageAI: 300 RPM)
    |
    |-> Log progress: {processed}/{total} chunks migrated
```

## Anti-Patterns

### Anti-Pattern 1: Mixed-Model Vector Search

**What people do:** Query wiki_pages with a voyage-code-3 query embedding when some rows have voyage-context-3 document embeddings (or vice versa).
**Why it's wrong:** Cosine similarity between vectors from different embedding models is meaningless. Results will be essentially random.
**Do this instead:** Ensure query embedding model always matches document embedding model. During migration, either mark un-migrated pages as `stale=true` (excluded from search) or migrate atomically.

### Anti-Pattern 2: Fetching Full Diffs for All Commits

**What people do:** Fetch complete patch content for every commit in the scan window to ground staleness analysis.
**Why it's wrong:** xbmc/xbmc has hundreds of commits per week. Full diffs can be megabytes. GitHub API rate limits will be exhausted.
**Do this instead:** Only fetch diff details for commits that pass the heuristic filter (file-path overlap with wiki pages). Truncate patches to summary length.

### Anti-Pattern 3: Single Mega-Comment for All Pages

**What people do:** Post one giant issue comment with all 20 pages' suggestions.
**Why it's wrong:** Exceeds GitHub's 65K character limit. Impossible to discuss individual pages. Cannot mark individual pages as resolved.
**Do this instead:** One comment per page. Each comment is independently actionable and discussable.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Voyage AI | HTTP API via `voyageai` SDK | Two model instances (voyage-code-3, voyage-context-3). Rate limit: 300 RPM shared across both. Migration script needs throttling. |
| MediaWiki (kodi.wiki) | HTTP API via `fetch()` | `linkshere` prop for link-in counts. No pageview stats available (extension not installed). |
| GitHub API (xbmc/wiki) | Octokit REST client | Issue creation + comments. Verify App installation covers xbmc/wiki repo. |
| GitHub API (xbmc/xbmc) | Octokit REST client | Enhanced commit/PR fetching for staleness grounding. Already used by existing staleness detector. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| EmbeddingProvider -> WikiPageStore | Direct call (injected) | Wiki store's `writeChunks()` hardcodes `"voyage-code-3"` as `embeddingModel` (line 87 of wiki-store.ts). Must be parameterized to accept model name from provider. |
| Staleness Detector -> Update Generator | Function call (pipeline) | Detector outputs `StalePage[]`; generator consumes it. No async boundary needed for one-shot pipeline. |
| Update Generator -> Issue Publisher | Function call (pipeline) | Generator outputs `UpdateSuggestion[]`; publisher formats and posts. |
| Retrieval -> Popularity Tracker | Fire-and-forget async | After `createRetriever()` returns, asynchronously update citation counts. Must not block retrieval response. |

## Database Changes

### New Migration: 020-wiki-page-popularity.sql

```sql
CREATE TABLE IF NOT EXISTS wiki_page_popularity (
  page_id INTEGER PRIMARY KEY,
  page_title TEXT NOT NULL,
  citation_count INTEGER NOT NULL DEFAULT 0,
  last_cited_at TIMESTAMPTZ,
  link_in_count INTEGER DEFAULT 0,
  computed_score FLOAT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wiki_popularity_score
  ON wiki_page_popularity (computed_score DESC);
```

### Existing Table Changes

**wiki_pages:** No schema change needed. The `embedding_model` column already exists and stores which model generated the embedding. The migration script updates existing rows from `'voyage-code-3'` to `'voyage-context-3'` as embeddings are regenerated.

**wiki_staleness_run_state:** May need additional columns if enhanced staleness wants to persist richer evidence (commit diffs, PR links). Evaluate during implementation -- could also be ephemeral (only lives during pipeline run).

## Sources

- [Voyage AI Embeddings Documentation](https://docs.voyageai.com/docs/embeddings) -- model specifications, dimension options
- [Voyage Context-3 Announcement](https://blog.voyageai.com/2025/07/23/voyage-context-3/) -- prose-optimized model details
- [MediaWiki PageViewInfo Extension](https://www.mediawiki.org/wiki/Extension:PageViewInfo) -- confirmed NOT installed on kodi.wiki
- [MediaWiki HitCounters Extension](https://www.mediawiki.org/wiki/Extension:HitCounters) -- alternative for self-hosted wikis
- kodi.wiki API testing (direct HTTP requests confirming no pageview modules available)
- Existing codebase: `src/knowledge/embeddings.ts`, `src/knowledge/wiki-store.ts`, `src/knowledge/wiki-staleness-detector.ts`, `src/knowledge/retrieval.ts`, `src/llm/task-types.ts`, `src/index.ts`

---
*Architecture research for: v0.25 Wiki Content Update Pipeline*
*Researched: 2026-03-02*

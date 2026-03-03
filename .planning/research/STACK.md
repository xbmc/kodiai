# Stack Research: v0.25 Wiki Content Updates

**Domain:** Wiki embedding migration, page popularity ranking, staleness enhancement, update generation, GitHub publishing
**Researched:** 2026-03-02
**Confidence:** HIGH (voyage-context-3, Octokit issues API) / MEDIUM (MediaWiki pageviews on kodi.wiki)

## Scope

This research covers ONLY what is needed for v0.25: migrating wiki embeddings from voyage-code-3 to voyage-context-3, obtaining page popularity signals from MediaWiki, and publishing update suggestions to xbmc/wiki via GitHub Issues API. The existing stack (PostgreSQL+pgvector, Voyage AI, Octokit, Vercel AI SDK, wiki staleness detector) is validated and not re-evaluated.

## Key Finding: voyage-context-3 Uses a Different API Endpoint

The most important discovery: **voyage-context-3 is NOT a drop-in replacement for voyage-code-3**. It uses a completely different API endpoint (`/v1/contextualizedembeddings` vs `/v1/embeddings`) with a different input format. The existing `EmbeddingProvider.generate(text, inputType)` interface cannot support it without changes.

## Recommended Stack Additions

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| voyageai (npm) | 0.1.0 (already installed) | Contextualized chunk embeddings via `client.contextualizedEmbed()` | Already in node_modules at 0.1.0; the SDK already exposes `contextualizedEmbed()` method with full TypeScript types. No package upgrade needed. |
| Octokit `rest.issues.create` | Already installed (@octokit/rest) | Create tracking issue in xbmc/wiki | Existing Octokit patterns used throughout codebase; same auth via GitHub App installation tokens. |
| Octokit `rest.issues.createComment` | Already installed | Post per-page update suggestions as comments | Already used by issue-comment-server.ts MCP tool; proven patterns with retry and rate limit handling. |

### No New Packages Required

Every capability needed for v0.25 is available through already-installed dependencies. The work is integration code, not new library adoption.

## voyage-context-3: Detailed Analysis

**Confidence: HIGH** (verified against installed SDK types in node_modules, official docs, and pricing page)

### What It Is

voyage-context-3 generates **contextualized chunk embeddings** -- each chunk is embedded with awareness of surrounding chunks in the same document. This is ideal for wiki pages where a section like "Configuration" means very different things depending on which page it belongs to.

### API Differences from voyage-code-3

| Aspect | voyage-code-3 (current) | voyage-context-3 (target) |
|--------|------------------------|--------------------------|
| Endpoint | `POST /v1/embeddings` | `POST /v1/contextualizedembeddings` |
| SDK method | `client.embed()` | `client.contextualizedEmbed()` |
| Input format | `input: string \| string[]` | `inputs: string[][]` (list of documents, each a list of chunks) |
| Input type | `inputType: "document" \| "query"` | `inputType: "document" \| "query"` |
| Output dimensions | 256, 512, 1024 (default), 2048 | 256, 512, 1024 (default), 2048 |
| Output format | `response.data[0].embedding` | `response.data[i].data[j].embedding` (nested: per-document, per-chunk) |
| Context length | 32,000 tokens | 32,000 tokens per inner list |
| Max per request | - | 1,000 inputs, 16,000 total chunks, 120,000 total tokens |
| Pricing | $0.18/1M tokens | $0.18/1M tokens (identical) |
| Free tier | 200M tokens | 200M tokens |

### SDK Types (Already Available in node_modules)

```typescript
// Request (from voyageai/api/client/requests/ContextualizedEmbedRequest.d.ts)
interface ContextualizedEmbedRequest {
  inputs: string[][];           // documents -> chunks
  model: string;                // "voyage-context-3"
  inputType?: "query" | "document";
  outputDimension?: number;     // 256, 512, 1024 (default), 2048
  outputDtype?: "float" | "int8" | "uint8" | "binary" | "ubinary";
}

// Response structure (nested)
interface ContextualizedEmbedResponseDataItem {
  object?: string;              // "list"
  data?: ContextualizedEmbedResponseDataItemDataItem[];  // per-chunk embeddings
  index?: number;               // document index in input
}

interface ContextualizedEmbedResponseDataItemDataItem {
  object?: string;              // "embedding"
  embedding?: number[];         // the vector
  index?: number;               // chunk index within document
}
```

### Migration Impact on EmbeddingProvider

The current `EmbeddingProvider` interface:
```typescript
type EmbeddingProvider = {
  generate(text: string, inputType: "document" | "query"): Promise<EmbeddingResult>;
  readonly model: string;
  readonly dimensions: number;
};
```

This interface embeds **one text at a time**. voyage-context-3 needs **all chunks of a document together** to provide contextualized embeddings. Two options:

**Option A (Recommended): Add a separate `ContextualizedEmbeddingProvider` interface**
- New interface: `generateContextualized(chunks: string[], inputType): Promise<EmbeddingResult[]>`
- Keep existing `EmbeddingProvider` for all other corpora (code, review comments, issues, snippets)
- Wiki backfill/sync uses the new interface; retrieval queries still use standard `generate()` for query embedding
- Clean separation; no risk to existing 4 corpora

**Option B: Extend existing interface with optional method**
- Add optional `generateContextualized?()` to `EmbeddingProvider`
- Wiki code checks for method existence before calling
- Muddies the interface; all consumers see a method they should not call

**Recommendation: Option A.** The contextualized API is fundamentally batch-oriented (one document = many chunks). Forcing it into the single-text interface creates impedance mismatch. A separate provider keeps the existing 4 corpora untouched.

### Query Embedding Compatibility

For **retrieval queries**, voyage-context-3 works with single-element input lists (behaves identically to standard embeddings per Voyage docs). The query embedding can use the same `contextualizedEmbed()` call with `inputs: [[query]]` and `inputType: "query"`. The resulting vectors are compatible with cosine similarity against document embeddings.

Alternatively, query embeddings can continue using the standard `embed()` endpoint with model `voyage-context-3` -- Voyage confirms the vector spaces are compatible. This means the retrieval pipeline can keep using the existing `EmbeddingProvider.generate()` for queries with just a model name change.

### Migration Strategy for Existing Wiki Embeddings

The wiki corpus has ~2,000-4,000 chunks across ~800+ pages (per backfill results from v0.18). Migration approach:

1. **Mark existing wiki embeddings as stale** (`UPDATE wiki_pages SET stale = true`)
2. **Re-embed page by page** using `contextualizedEmbed()`, sending all chunks for each page as one document
3. **Update embedding_model column** from `voyage-code-3` to `voyage-context-3`
4. **Query-time**: Use voyage-context-3 model name for wiki query embeddings; other corpora keep voyage-code-3

The `embedding_model` column already exists on `wiki_pages` -- set during writes in `wiki-store.ts`. The `stale` column and `markStale()` pattern already exist on `learning_memories` store.

### Per-Corpus Model Selection

Currently `src/index.ts` creates a single `embeddingProvider` with model `voyage-code-3`. For v0.25:

- **Code, review comments, issues, snippets**: Keep `voyage-code-3` (code-optimized)
- **Wiki pages**: Use `voyage-context-3` (prose-optimized with document context)

Implementation: Create two provider instances at startup. Pass the wiki-specific provider to wiki-related stores/sync. The `createEmbeddingProvider()` factory already accepts a `model` parameter -- just instantiate twice with different models.

## MediaWiki Page View Statistics

**Confidence: MEDIUM** (PageViewInfo extension availability on kodi.wiki unverified due to Cloudflare blocking)

### The Problem

kodi.wiki is a self-hosted MediaWiki instance (not Wikimedia/Wikipedia). The standard `prop=pageviews` API requires the **PageViewInfo extension**, which:

1. **Depends on Wikimedia's analytics infrastructure** -- the only implemented `PageViewService` class queries Wikimedia's Pageview API
2. **Will not work on self-hosted wikis** without significant custom development
3. May or may not be installed on kodi.wiki (could not verify -- Cloudflare JS challenge blocks API calls from curl/fetch)

### Alternative: HitCounters Extension

The **HitCounters** extension is the community standard for self-hosted MediaWiki page view tracking:
- Stores view counts server-side in the database
- Exposes counts via `Special:PopularPages` special page
- However, it does NOT expose an API endpoint -- data is only available via HTML scraping or direct DB queries

### Recommended Approach: Hybrid Popularity Score Without MediaWiki Pageviews

Since MediaWiki pageview data may be unavailable or unreliable on kodi.wiki, use a **retrieval-based popularity proxy**:

| Signal | Source | How to Collect | Reliability |
|--------|--------|----------------|-------------|
| **Retrieval citation frequency** | PostgreSQL (existing) | COUNT queries grouping by page_id across retrieval logs | HIGH -- already have the data |
| **Wiki search hit frequency** | PostgreSQL (existing) | Track which wiki chunks appear in search results | HIGH -- can add lightweight logging |
| **Staleness detector flag count** | PostgreSQL (existing) | Count how often each page appears in staleness scan results | HIGH -- from wiki_staleness_run_state |
| **MediaWiki page view counts** | kodi.wiki API | `prop=pageviews` if PageViewInfo is installed | LOW -- may not be available |
| **Inbound link count** | kodi.wiki API | `prop=links` or `action=query&list=backlinks` | MEDIUM -- available on all MediaWiki |

**Primary recommendation**: Combine retrieval citation frequency (how often Kodiai references each page in reviews/mentions) with MediaWiki backlink count (how many other wiki pages link to it). This gives a reliable popularity signal without depending on pageview tracking.

**Fallback plan for pageviews**: Try the `prop=pageviews` API at runtime. If it returns an error/warning (extension not installed), fall back to backlinks-only. The existing `wiki-sync.ts` already makes MediaWiki API calls through Cloudflare successfully (it has proper session handling), so the 403s from curl are not a concern for the running application.

### MediaWiki Backlinks API (Guaranteed Available)

```
GET /w/api.php?action=query&list=backlinks&bltitle=HOW-TO:Modify_keymaps&bllimit=500&format=json
```

Response:
```json
{
  "query": {
    "backlinks": [
      { "pageid": 123, "ns": 0, "title": "Keymap" },
      { "pageid": 456, "ns": 0, "title": "Settings" }
    ]
  }
}
```

This is available on ALL MediaWiki instances with no extensions required. More backlinks = more interconnected = more important page.

### MediaWiki Pageviews API (May Be Available)

```
GET /w/api.php?action=query&titles=HOW-TO:Modify_keymaps&prop=pageviews&pvipdays=60&format=json
```

If PageViewInfo is installed, returns:
```json
{
  "query": {
    "pages": {
      "12345": {
        "title": "HOW-TO:Modify keymaps",
        "pageviews": {
          "2026-02-01": 150,
          "2026-02-02": 142
        }
      }
    }
  }
}
```

If NOT installed, returns a warning like `"warnings": {"pageviews": {"*": "Unrecognized value..."}}`.

**Implementation**: Try pageviews first, detect the warning, fall back gracefully.

## GitHub Issues API for xbmc/wiki

**Confidence: HIGH** (verified repo exists, is private, has issues enabled, existing Octokit patterns proven)

### Repository Context

- **Repo**: `xbmc/wiki` (private, issues enabled, default branch: `main`)
- **Existing issues**: Only 4 issues exist (low-activity repo), e.g., #4 "Wiki Clean Out and Maintenance"
- **GitHub App access**: The kodiai GitHub App needs to be installed on xbmc/wiki with `issues: write` permission. If not already installed, this is a one-click operation in GitHub App settings.

### API Patterns Needed

**1. Create tracking issue** (one-time, per update batch):
```typescript
const { data: issue } = await octokit.rest.issues.create({
  owner: "xbmc",
  repo: "wiki",
  title: "Wiki Content Updates - March 2026",
  body: "Tracking issue for wiki page update suggestions...",
  labels: ["wiki-updates"],  // optional, label must pre-exist
});
```

**2. Post per-page update comment** (one per stale page):
```typescript
const { data: comment } = await octokit.rest.issues.createComment({
  owner: "xbmc",
  repo: "wiki",
  issue_number: issue.number,
  body: markdownUpdateSuggestion,  // section-by-section rewrite suggestions
});
```

### Reuse of Existing Code

The `src/execution/mcp/issue-comment-server.ts` already implements:
- `createCommentHandler()` with retry logic (exponential backoff on 429s)
- `enforceMaxLength()` truncation at 60,000 chars
- `formatStructuredComment()` with title/body/suggestions
- Error mapping for 404/403/429

However, this MCP server is scoped to the **current repo** (owner/repo from webhook context). For xbmc/wiki publishing, the code needs a direct Octokit call with explicit `owner: "xbmc", repo: "wiki"` -- not the MCP tool.

**Recommendation**: Create a thin `WikiUpdatePublisher` module that:
1. Gets an Octokit instance for xbmc/wiki installation
2. Creates or finds the tracking issue
3. Posts comments with the same retry/truncation patterns from issue-comment-server.ts
4. Does NOT go through MCP (this is a scheduled/manual pipeline, not an agent tool)

### Authentication for xbmc/wiki

The `src/auth/github-app.ts` provides `getInstallationOctokit(installationId)`. The app needs:
1. To be installed on xbmc/wiki (org-level install on xbmc likely covers it)
2. `issues: write` permission in the installation

The wiki staleness detector (`wiki-staleness-detector.ts`) already uses `githubApp` to get Octokit for xbmc/xbmc -- the same pattern works for xbmc/wiki with a different installation lookup.

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@anthropic-ai/sdk` for update generation | Already have Vercel AI SDK `generateText()` for non-agentic tasks | `generateWithFallback()` with task type `wiki-update-suggestion` |
| Custom pageview tracking DB | Over-engineering for a "top 20 pages" one-shot feature | Retrieval citation frequency + backlinks as popularity proxy |
| `mediawiki` npm package | Abandoned packages, poor TypeScript support | Direct `fetch()` calls to MediaWiki API (already proven in wiki-sync.ts and wiki-backfill.ts) |
| GitHub Actions workflow for publishing | Adds CI complexity; this is a one-shot manual trigger | Direct Octokit calls from the app's scheduled/manual pipeline |
| `cheerio` for HTML parsing of Special:PopularPages | Brittle scraping | API-based backlinks count |
| New embedding package/provider | voyageai 0.1.0 already has `contextualizedEmbed()` | Use existing installed SDK |

## Installation

No new packages needed. Zero `npm install` commands.

```bash
# Nothing to install -- all dependencies already available:
# - voyageai@0.1.0 (contextualizedEmbed already in SDK)
# - @octokit/rest (issues.create, issues.createComment)
# - Vercel AI SDK (generateText for update suggestion generation)
# - postgres.js (retrieval citation counting queries)
```

## Version Compatibility

| Package | Installed Version | Required Feature | Status |
|---------|-------------------|------------------|--------|
| voyageai | 0.1.0 | `client.contextualizedEmbed()` | Available (verified in node_modules/voyageai/Client.d.ts) |
| @octokit/rest | (current) | `rest.issues.create`, `rest.issues.createComment` | Available (used throughout codebase) |
| postgres.js | (current) | Aggregation queries for citation counting | Available |

## Migration Checklist

For the voyage-context-3 embedding migration:

1. **DB migration**: No schema change needed -- `wiki_pages.embedding` is already `vector(1024)` and `embedding_model` is TEXT
2. **New provider instance**: Create second `EmbeddingProvider`-like instance with `contextualizedEmbed()` API
3. **Mark stale**: `UPDATE wiki_pages SET stale = true, embedding = NULL, embedding_model = NULL`
4. **Re-embed**: Iterate pages, send all chunks per page to `contextualizedEmbed()`, update rows
5. **Query routing**: Wiki retrieval uses voyage-context-3 model for query embedding; other corpora unchanged
6. **Incremental sync update**: `wiki-sync.ts` uses new contextualized provider for new/changed pages

## Sources

- [Voyage AI Contextualized Chunk Embeddings Docs](https://docs.voyageai.com/docs/contextualized-chunk-embeddings) -- API format, capabilities
- [Voyage AI Contextualized Embeddings API Reference](https://docs.voyageai.com/reference/contextualized-embeddings-api) -- request/response spec, limits
- [Voyage AI Pricing](https://docs.voyageai.com/docs/pricing) -- $0.18/1M tokens for both voyage-code-3 and voyage-context-3
- [Voyage AI Text Embeddings Docs](https://docs.voyageai.com/docs/embeddings) -- model comparison table
- [voyage-context-3 Blog Post](https://blog.voyageai.com/2025/07/23/voyage-context-3/) -- performance benchmarks vs alternatives
- [MediaWiki Extension:PageViewInfo](https://www.mediawiki.org/wiki/Extension:PageViewInfo) -- requires Wikimedia infrastructure, not suitable for self-hosted
- [MediaWiki Extension:HitCounters](https://www.mediawiki.org/wiki/Extension:HitCounters) -- community alternative for self-hosted, no API
- [GitHub Working with Comments](https://docs.github.com/en/rest/guides/working-with-comments) -- issues API patterns
- Verified: `node_modules/voyageai/Client.d.ts` -- SDK already exposes `contextualizedEmbed()` method
- Verified: `xbmc/wiki` repo via `gh api` -- private, issues enabled, 4 existing issues
- Verified: `src/execution/mcp/issue-comment-server.ts` -- existing retry/truncation patterns
- Verified: `src/knowledge/wiki-sync.ts` -- existing MediaWiki API call patterns

---
*Stack research for: v0.25 Wiki Content Updates*
*Researched: 2026-03-02*

# Knowledge System

The knowledge system is Kodiai's 5-corpus retrieval pipeline that provides context-aware code reviews and conversational responses. It stores and retrieves past review findings, review comment threads, wiki pages, code snippets from PR diffs, and issue discussions — combining vector similarity search with BM25 full-text search through a two-stage Reciprocal Rank Fusion (RRF) merge. All embeddings are generated via Voyage AI and stored in PostgreSQL with pgvector. For system-level context, see [architecture.md](architecture.md). For configuration options, see [configuration.md](configuration.md).

## Corpora

The knowledge system maintains five independent corpora, each with its own store, chunking strategy, and embedding model:

| Corpus | Store | Chunker | Embedding Model | Description |
|--------|-------|---------|-----------------|-------------|
| Learning memories | `memory-store.ts` | N/A (finding text) | `voyage-code-3` | Past review findings with severity, category, and outcome — the core learning loop |
| Review comments | `review-comment-store.ts` | `review-comment-chunker.ts` | `voyage-code-3` | PR review comment threads grouped by file position and thread context |
| Wiki pages | `wiki-store.ts` | `wiki-chunker.ts` | `voyage-context-3` | MediaWiki documentation pages with section-based chunking and language tags |
| Code snippets | `code-snippet-store.ts` | `code-snippet-chunker.ts` | `voyage-code-3` | Diff hunks from merged PRs with file path, function context, and language |
| Issues | `issue-store.ts` | `issue-comment-chunker.ts` | `voyage-code-3` | Issue bodies and comment threads for troubleshooting and precedent lookup |

## Chunking Strategies

Each corpus uses a chunking strategy tailored to its content structure:

**Learning memories** are stored as-is — each finding's text becomes a single embedding unit. No further chunking is needed since findings are already concise review observations.

**Review comments** use thread-based chunking. Comments are grouped by thread ID (derived from file path, position, and PR number). Bot comments (Dependabot, Renovate, Codecov, etc.) are filtered out. Each thread becomes a chunk that preserves the conversational context of a review discussion.

**Wiki pages** use section-based chunking. Pages are split at heading boundaries (H2/H3), preserving section headings and hierarchy. Code blocks within sections are detected and their languages are extracted to build per-chunk language tags. This enables language-aware retrieval — a wiki page about Python patterns can be boosted when reviewing Python code.

**Code snippets** use diff hunk chunking. Unified diffs from merged PRs are parsed at `@@` hunk boundaries. Only hunks with additions are embedded (pure-deletion hunks are excluded). Each hunk's embedding text includes the file path, function context line, language classification, and the added lines. A minimum changed-lines threshold (default: 3) filters trivial hunks. Glob-based exclude patterns skip generated files, lockfiles, and vendor directories.

**Issues** use comment-based chunking. Issue bodies and comments are processed similarly to review comments — bot comments are filtered, and the remaining content is chunked for embedding. This captures the full discussion context of issue resolution.

## Embedding Models

The knowledge system uses two Voyage AI embedding models, both producing 1024-dimensional vectors stored in pgvector `vector(1024)` columns:

**`voyage-code-3`** — Used for code-centric corpora (learning memories, review comments, code snippets, issues). Optimized for code understanding, function signatures, and technical discussions. Uses the standard `embed()` API.

**`voyage-context-3`** — Used exclusively for wiki pages. Uses Voyage AI's contextualized embedding API (`contextualizedEmbed()`), which accepts all chunks of a page as a single document so the model can see shared page context when embedding individual sections. The `contextualizedEmbedChunks()` helper batches all chunks of a page into one API call for efficient embedding.

Both providers implement fail-open semantics: if the Voyage AI API is unavailable or returns an error, the provider returns `null` instead of throwing. When no API key is configured, a no-op provider is used that always returns `null`, allowing Kodiai to operate without embeddings (retrieval is silently disabled).

## Unified Retrieval Pipeline

The `createRetriever()` function in `retrieval.ts` implements the full retrieval pipeline. When a review, mention, or question triggers retrieval, the following steps execute:

1. **Build query variants** — The input queries are mapped to variant types (`intent`, `file-path`, `code-shape`) that capture different retrieval angles. The intent variant captures semantic meaning, file-path focuses on structural context, and code-shape targets code patterns.

2. **Parallel fan-out** — Nine searches execute concurrently via `Promise.allSettled()` (fail-open per search):
   - Learning memory vector search (multi-variant, up to 2 concurrent)
   - Review comment vector search
   - Wiki page vector search (uses `voyage-context-3` provider)
   - Code snippet vector search
   - Issue vector search
   - Learning memory BM25 full-text search
   - Review comment BM25 full-text search
   - Wiki page BM25 full-text search
   - Issue BM25 full-text search

3. **Per-corpus hybrid merge** — For each corpus that has both vector and BM25 results, the results are merged using per-corpus RRF (see [Two-Stage RRF](#two-stage-rrf) below).

4. **Within-corpus deduplication** — Each corpus's merged results are deduplicated using Jaccard similarity (see [Deduplication](#deduplication)) to prevent duplicate inflation before cross-corpus merging.

5. **Cross-corpus RRF** — The deduplicated results from all five corpora are merged into a single ranked list using cross-corpus RRF with a recency boost for items created in the last 30 days.

6. **Source weighting** — Context-dependent multipliers adjust scores based on the trigger type:
   - `pr_review`: boosts code (1.2×) and review comments (1.2×), reduces issues (0.8×)
   - `issue`: boosts issues (1.5×) and wiki (1.2×), reduces snippets (0.8×)
   - `question`: boosts wiki (1.2×) and issues (1.2×)
   - `slack`: neutral weights across all sources

7. **Language-aware boost** — Chunks matching the PR's languages receive a proportional boost. The boost is proportional to each language's share of the PR changes (e.g., if 80% of changes are C++, C++ chunks get a larger boost than Python chunks at 20%). Related languages (C/C++, TypeScript/JavaScript) receive a partial boost. Non-matching chunks are never penalized.

8. **Cross-corpus deduplication** — A final Jaccard deduplication pass removes near-duplicates that appear across different corpora.

9. **Context assembly** — The top results are assembled into a context window string, each prefixed with a source label (e.g., `[code: file.ts]`, `[wiki: Page Title]`, `[review: PR #123]`). The window respects a configurable character budget (`maxContextChars`).

The pipeline returns both the unified results and legacy per-corpus results for backward compatibility, along with full provenance metadata (query count, candidate count, threshold method, corpus counts, etc.).

## Two-Stage RRF

The retrieval pipeline uses Reciprocal Rank Fusion at two levels:

### Per-Corpus Hybrid Merge

Within each corpus, vector similarity results and BM25 full-text search results are merged using RRF. For each item at rank position `i`, the score contribution is `1 / (k + i)` where `k = 60` (the standard RRF constant from Cormack, Clarke & Butt 2009). Items appearing in both the vector and BM25 result lists receive the sum of their scores from both lists. This is implemented in `hybrid-search.ts`.

The hybrid merge ensures that retrieval benefits from both semantic similarity (vector search captures meaning) and lexical matching (BM25 catches exact terms, identifiers, and error messages that embeddings may miss).

### Cross-Corpus Merge

After per-corpus merging and within-corpus deduplication, the ranked lists from all five corpora are merged using a second RRF pass in `cross-corpus-rrf.ts`. The same `1 / (k + rank)` formula is applied, with items that appear across multiple corpora receiving summed scores. A recency boost of 15% is applied to items created within the last 30 days. The result is a single unified ranked list ordered by RRF score.

## Deduplication

Near-duplicate chunks are collapsed using token-level Jaccard similarity (implemented in `dedup.ts`). Text is lowercased and whitespace-tokenized, then the Jaccard coefficient (intersection/union of token sets) is computed between chunk pairs. Chunks with similarity ≥ 0.90 are considered duplicates.

Deduplication runs at two stages:

1. **Within-corpus** (before cross-corpus RRF) — Prevents a single corpus from inflating its representation with near-identical chunks
2. **Cross-corpus** (after RRF merge and scoring) — Catches duplicates that span corpora (e.g., the same guidance appearing in both a review comment and a wiki page)

When a duplicate is found, the highest-ranked chunk is kept and the duplicate's source label is recorded in `alternateSources` for provenance tracking.

## Adaptive Thresholds

The adaptive threshold system (in `adaptive-threshold.ts`) dynamically determines the distance cutoff for including results, rather than relying solely on a fixed configured threshold. Three methods are tried in order:

1. **Gap-based** (≥ 8 candidates) — Finds the largest gap between consecutive sorted distances. If the gap exceeds `minGapSize` (0.05), the threshold is set at the distance just before the gap, naturally separating relevant from irrelevant results.

2. **Percentile fallback** (< 8 candidates) — When there aren't enough candidates for gap detection, uses the 75th percentile distance as the threshold.

3. **Configured fallback** — If the gap is too small (< 0.05), falls back to the configured threshold from repository settings.

All computed thresholds are clamped between a floor (0.15) and ceiling (0.65) to prevent extreme values.

## Language-Aware Reranking

Two layers of language awareness improve retrieval relevance for multilingual repositories:

**Legacy reranking** (`retrieval-rerank.ts`) — Applied to learning memory results before the unified pipeline. Same-language matches receive a distance multiplier of 0.85 (lower distance = higher relevance). Related languages (C/C++, TypeScript/JavaScript, Objective-C/C) receive a partial boost. Non-matching languages are never penalized — the multiplier stays at 1.0.

**Unified pipeline boost** (`retrieval.ts`) — Applied to all unified results after cross-corpus RRF. Language weights are proportional to the PR's language distribution: if 80% of changed files are TypeScript, TypeScript chunks receive a larger boost than languages representing 10% of changes. The boost factor is 0.25 for exact matches and 0.125 (50% of exact) for related languages. Non-matching chunks are never penalized.

## Recency Weighting

Recency weighting (`retrieval-recency.ts`) applies exponential decay to learning memory results based on age:

- **Half-life:** 90 days — a 90-day-old finding's recency multiplier is 0.5
- **Severity floor:** Critical and major findings have a floor multiplier of 0.3 (they remain somewhat relevant even when old). Other severities have a floor of 0.15.
- The multiplier is converted to distance space: `factor = 2 - multiplier`, so a fresh finding (multiplier ≈ 1.0) gets no penalty, while old findings (multiplier → floor) get pushed further away in distance

This ensures recent findings are preferred while preventing high-severity historical findings from being completely buried.

## Snippet Anchoring

Snippet anchoring (`retrieval-snippets.ts`) maps retrieved findings to actual file locations in the current workspace. For each retrieved learning memory finding:

1. The finding's file path is checked against the workspace directory
2. If the file exists, the finding text is tokenized and searched within the file content
3. Matching line numbers are recorded as anchors with a surrounding snippet (up to 180 characters)
4. Anchors are trimmed to a character budget and item limit to fit within the context window

This bridges the gap between historical findings and current code, showing reviewers exactly where a past pattern appears in the current PR's codebase.

## Repo Isolation

The isolation layer (`isolation.ts`) enforces repository-scoped retrieval with optional owner-level sharing:

- **Repo-scoped** (default) — Each repository's knowledge is isolated. Queries only search within the repository's own stored memories.
- **Owner-level sharing** — When `knowledge.sharing.enabled` is `true`, queries additionally search a shared pool across all repositories under the same GitHub organization/owner. Results from the shared pool are tagged with provenance metadata indicating they came from a different repository.

Isolation is enforced at the store level — embedding queries include the repository identifier as a filter predicate, and shared pool queries expand the scope to the owner level.

## Background Systems

### Wiki Sync

The wiki sync system (`wiki-sync.ts`) keeps the wiki corpus up to date by polling MediaWiki's RecentChanges API on a configurable interval (default: 24 hours, with a 60-second startup delay). On each cycle:

1. Fetches recently changed pages from the MediaWiki API
2. For each changed page, fetches the current content via the Parse API
3. Chunks the page content using the wiki chunker (section-based splitting)
4. Generates contextualized embeddings via `voyage-context-3`
5. Upserts updated pages and removes deleted pages from the store

The sync result reports pages checked, updated, and deleted along with cycle duration.

### Wiki Staleness Detection

The staleness detector (`wiki-staleness-detector.ts`) identifies wiki pages that may be outdated due to recent code changes. It runs on a weekly schedule (default: 7-day interval) with a two-tier evaluation:

1. **Heuristic scoring** — Compares merged PR content (titles, changed files, diff text) against wiki page content using token overlap. Pages with significant overlap are candidates for staleness.
2. **LLM evaluation** — The top candidates (capped at 20 per cycle) are evaluated by an LLM to determine if the code changes actually invalidate the wiki content.
3. **Reporting** — Stale pages are reported via Slack with the specific code changes that triggered the staleness flag.

Run state (last run timestamp, last commit SHA, pages flagged/evaluated) is persisted in PostgreSQL for reliable resumption.

### Review Comment Clustering

The cluster pipeline (`cluster-pipeline.ts`) discovers recurring patterns in review comments using unsupervised machine learning:

1. **Embedding fetch** — Loads 6-month review comment embeddings from PostgreSQL
2. **Incremental merge** — New embeddings are first checked against existing clusters using cosine similarity (threshold: 0.5). Matching embeddings are assigned to existing clusters without re-clustering.
3. **UMAP reduction** — Remaining embeddings are reduced from 1024 to 15 dimensions using UMAP (n_neighbors=15, min_dist=0.0)
4. **HDBSCAN clustering** — The reduced data is clustered using HDBSCAN (min_cluster_size=3)
5. **LLM labeling** — Each cluster receives a two-layer label (slug + description) generated by an LLM from representative samples (5 per cluster). Labels are regenerated when cluster membership changes by ≥ 20%.
6. **Persistence** — Cluster assignments are stored in PostgreSQL. Stale clusters (< 3 members in a 60-day window) are retired.

The cluster scheduler (`cluster-scheduler.ts`) runs re-clustering on a configurable schedule.

## Configuration Reference

Knowledge system settings are configured in the repository's `.kodiai.yml` file under the `knowledge` key. Key settings include:

| Setting | Default | Description |
|---------|---------|-------------|
| `knowledge.retrieval.enabled` | `true` | Enable/disable knowledge retrieval |
| `knowledge.retrieval.topK` | `5` | Maximum results returned per retrieval |
| `knowledge.retrieval.adaptive` | `true` | Enable adaptive threshold calculation |
| `knowledge.sharing.enabled` | `false` | Enable owner-level knowledge sharing across repos |
| `knowledge.embeddings.enabled` | `true` | Enable embedding generation |
| `knowledge.retrieval.hunkEmbedding.enabled` | `true` | Enable hunk-level diff embedding |
| `knowledge.retrieval.hunkEmbedding.excludePatterns` | See config | Glob patterns to exclude from hunk embedding |

For the full configuration reference, see [configuration.md](configuration.md#knowledge).

# Feature Landscape: Wiki Content Update Pipeline

**Domain:** Wiki content maintenance automation for AI-powered code review bot
**Researched:** 2026-03-02
**Milestone:** v0.25 Wiki Content Updates

## Scope

This document covers ONLY the five new features for v0.25. It does not cover existing capabilities (wiki export/chunking/embedding, two-tier staleness detection, scheduled Slack reports, 5-corpus hybrid retrieval, issue intelligence).

---

## Table Stakes

Features that are essential for the pipeline to deliver value. Without these, the milestone is incomplete.

| Feature | Why Essential | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| Embedding model migration (wiki corpus only) | Wiki content is prose, not code. voyage-code-3 is optimized for code retrieval; wiki search quality will improve with a prose-optimized model. Without migration, the entire pipeline operates on suboptimal embeddings for its primary content type. | Medium | `wiki-store.ts` (embedding column, embedding_model column), `embeddings.ts` (provider factory), `wiki-sync.ts` (embeds on ingest), `retrieval.ts` (query embedding must match) |
| Code-grounded staleness detection | Current heuristic uses token overlap between wiki text and changed file paths -- too noisy. Ground truth from actual code diffs (what functions/APIs/configs changed) dramatically reduces false positives and enables actionable rewrite suggestions. | Medium-High | `wiki-staleness-detector.ts` (heuristic + LLM pipeline), GitHub commits API (already used), `wiki-store.ts` (chunk retrieval) |
| LLM-generated section-level rewrite suggestions | The core deliverable. Without concrete "change X to Y" suggestions, the pipeline only identifies problems without solving them. Section-level granularity matches existing wiki chunking. | High | Staleness detection output (stale pages + evidence), `wiki-store.ts` (full page content retrieval), `generateWithFallback` (LLM generation), task router (model selection) |
| Batch publishing to GitHub issues | Output channel. Without this, rewrite suggestions have no destination. GitHub issues in xbmc/wiki is the agreed-upon delivery mechanism per PROJECT.md scope. | Medium | `github_issue_comment` MCP tool (exists but for single comments), Octokit (issue creation), GitHub API rate limits |

## Differentiators

Features that enhance quality but could be deferred without blocking the core pipeline.

| Feature | Value Proposition | Complexity | Dependencies on Existing |
|---------|-------------------|------------|--------------------------|
| Page popularity scoring | Prioritizes the top 20 pages by actual importance rather than arbitrary selection. Ensures effort is spent on pages that matter most. Two signals: MediaWiki link graph + retrieval citation frequency. | Medium | `wiki-store.ts` (page metadata), MediaWiki API (link counts -- see caveat below), retrieval pipeline (citation tracking does NOT exist yet) |
| Per-corpus embedding model selection in retrieval | Enables wiki corpus to use voyage-context-3 while code/review/issue corpora keep voyage-code-3. Prevents forcing a single model on heterogeneous content types. | Low-Medium | `embeddings.ts` (single provider currently), `retrieval.ts` (single embeddingProvider passed to all search functions), `cross-corpus-rrf.ts` (merges results) |

---

## Feature Deep Dives

### 1. Embedding Model Migration (Wiki Corpus)

**Goal:** Re-embed all wiki_pages rows from voyage-code-3 to voyage-context-3.

**Why voyage-context-3:** HIGH confidence (official Voyage AI blog, Dec 2025)
- Contextual chunk embeddings: each chunk vector encodes awareness of surrounding document context, not just the chunk in isolation. This is exactly what wiki section chunks need.
- 14.24% retrieval improvement over OpenAI-v3-large on chunk-level tasks.
- Same dimensions (1024 default) and same quantization options as voyage-code-3 -- drop-in compatible at the vector level.
- First 200M tokens free -- wiki corpus is small enough to fall within this tier.
- Matryoshka support (2048/1024/512/256) matches existing dimension flexibility.

**Migration strategy:** Atomic batch re-embed, not dual-index.
- The wiki corpus is small enough (under 5000 chunks per PROJECT.md) to re-embed in a single batch run.
- The `embedding_model` column already exists in the schema -- currently hardcoded to "voyage-code-3" in `wiki-store.ts` writeChunks/replacePageChunks.
- Batch re-embed script: SELECT rows WHERE embedding_model = 'voyage-code-3' OR embedding_model IS NULL, generate new embedding via voyage-context-3, UPDATE embedding and embedding_model columns.
- HNSW indexes work across embedding models if dimensions match (1024), but vectors from different models are NOT comparable in the same vector space. Must re-embed ALL wiki rows atomically before any queries use the new model.
- Query-time embedding must use the same model. This drives the per-corpus model selection requirement.

**Key constraint:** Voyage-context-3 embeddings and voyage-code-3 embeddings occupy different vector spaces even at the same dimensionality. You CANNOT mix them in the same HNSW index for meaningful retrieval. All wiki chunks must be migrated before switching the query model.

**Implementation notes:**
- The `createEmbeddingProvider()` in `embeddings.ts` accepts a `model` parameter. Create a second provider instance for wiki-specific embedding.
- The wiki-sync job (`wiki-sync.ts`) must be updated to use the new provider for future ingest.
- Batch size: 10-20 texts per API call to balance throughput and error handling. Voyage AI supports batch embedding.
- Error handling: if any embedding fails, skip that chunk and log. Re-run script to catch stragglers.

**Complexity:** Medium. The batch re-embed is straightforward; the hard part is ensuring retrieval queries use the correct model per corpus.

### 2. Per-Corpus Embedding Model Selection

**Goal:** Allow different embedding models per corpus in the retrieval pipeline.

**Current state:** A single `EmbeddingProvider` instance is created in `src/index.ts` with model "voyage-code-3" and passed to `createRetriever()`. All corpus search functions (`searchWikiPages`, `searchReviewComments`, `searchCodeSnippets`, `searchIssues`) receive the same provider.

**Required change:** The retriever factory needs a map of corpus-to-provider instead of a single provider:
```typescript
type CorpusProviders = {
  code: EmbeddingProvider;       // voyage-code-3
  reviewComments: EmbeddingProvider; // voyage-code-3
  wiki: EmbeddingProvider;       // voyage-context-3
  codeSnippets: EmbeddingProvider;   // voyage-code-3
  issues: EmbeddingProvider;     // voyage-code-3
};
```

**Key design points:**
- Most corpora continue using voyage-code-3 (code-optimized content).
- Only the wiki corpus switches to voyage-context-3 (prose-optimized).
- Query embedding must use the SAME model as the corpus being searched. Each search function generates its own query embedding using its assigned provider.
- The cross-corpus RRF merge operates on normalized scores, so mixing results from different embedding models is fine at the ranking level.

**Complexity:** Low-Medium. Mostly plumbing changes to thread the right provider to each search function.

### 3. Page Popularity Scoring

**Goal:** Rank wiki pages by importance to prioritize the top 20 for update suggestions.

**Two signals:**

**Signal A: MediaWiki link graph (inbound link count)**
- VERIFIED: The Kodi wiki (kodi.wiki) does NOT have the PageViewInfo extension installed. The API call `?action=query&prop=pageviews` returns "Unrecognized value for parameter 'prop': pageviews". View counts are NOT available.
- Use MediaWiki `action=query&prop=linkshere` to count inbound links per page. Pages with more inbound links are structurally more important in the wiki graph. This is the same signal Google's PageRank uses.
- Alternative: `action=query&list=backlinks&bltitle=PAGE` counts pages that link to a given page.
- This signal is static and does not require historical tracking -- fetch once per pipeline run.

**Signal B: Retrieval citation frequency**
- This signal does NOT currently exist in the codebase. No citation counting or frequency tracking is implemented.
- Requires: adding a counter/log when wiki chunks appear in retrieval results that get published (PR reviews, mention responses, Slack answers).
- Implementation: lightweight `wiki_page_citations` table with `(page_id, cited_at, trigger_type)` rows, or a simpler `citation_count` column on a new `wiki_page_stats` table incremented atomically in the publish path.
- Cold start problem: until enough retrieval events accumulate, this signal will be sparse.

**Recommendation for v0.25:** Use inbound link count as the primary popularity signal. Defer citation frequency tracking to a follow-up. The cold start problem means citation data will not be meaningful for the first pipeline run anyway.

**Composite score (v0.25):**
```
popularity = (normalized_inbound_links * 0.6) + (normalized_edit_recency * 0.4)
```
Edit recency is available from the existing `last_modified` column on wiki_pages.

**Complexity:** Medium. MediaWiki API for inbound links is straightforward. The main work is building the scoring/ranking layer and selecting top 20.

### 4. Code-Grounded Staleness Detection

**Goal:** Replace/enhance the token-overlap heuristic with actual code change analysis.

**Current state:** The existing `wiki-staleness-detector.ts` uses a two-tier pipeline:
1. Heuristic pass: tokenizes wiki chunk text and changed file paths, counts overlapping tokens (score >= 1 = candidate).
2. LLM pass: top 20 candidates evaluated by LLM with wiki excerpt + changed file list.

**Problem:** The heuristic is path-based only. It knows FILE X changed but not WHAT changed in file X. The LLM gets file paths but not diffs, so it guesses at relevance.

**Enhancement approach:**
- Fetch actual diff content for affecting commits. The existing `fetchChangedFiles()` in `wiki-staleness-detector.ts` calls `octokit.repos.getCommit()` which already returns `patch` data per file via `detail.data.files[].patch`.
- Extract semantic signals from diffs: function/method signatures added/removed/renamed, API endpoint changes, configuration key changes, class renames.
- Feed diff excerpts (budget-limited) into the LLM evaluation prompt alongside wiki content.
- The LLM can then make grounded assessments: "The wiki says `callX()` but the diff shows `callX` was renamed to `callY`."

**Diff excerpt budget:** Cap at approximately 2000 tokens of diff content per candidate page. Prioritize hunks that contain keyword overlap with the wiki chunk content.

**What to extract from diffs:**
- Function/method signature changes (regex patterns for C++/Python/JS)
- API endpoint string changes
- Configuration key/value changes
- Class/struct renames
- Removed/added includes/imports
- Build system changes (CMakeLists.txt, Makefile changes)

**Enhanced LLM prompt structure:**
```
Wiki page: "{title}"
Wiki content (excerpts): {chunk texts}
Changed files: {file paths}
Relevant code changes:
--- {file path}
{diff excerpt with keyword-overlapping hunks}
---

Based on the ACTUAL CODE CHANGES shown above, is this wiki page outdated?
If yes, identify SPECIFIC statements in the wiki that contradict the code changes.
```

**Key improvement:** The LLM now has evidence to ground its assessment rather than speculating from file paths alone. This directly aligns with the epistemic guardrails established in v0.24 -- the staleness assessment is grounded in observable diff content, not inferred from file names.

**Complexity:** Medium-High. Fetching commit details is already done; the new work is extracting relevant diff hunks, budget-limiting them, and integrating into the LLM prompt.

### 5. LLM-Generated Section-by-Section Rewrite Suggestions

**Goal:** For each stale page, generate concrete update text for each affected section.

**Architecture:**
```
Stale page (from enhanced detector)
  + Full page content (all chunks ordered by chunk_index from wiki-store)
  + Code evidence (diff excerpts from grounded detection)
  --> LLM generates section-level rewrites
  --> Structured output: [{ sectionHeading, suggestedText, rationale }]
```

**Section granularity:** Use existing section-based chunking from `wiki-chunker.ts`. Each wiki page is already split at heading boundaries with `sectionHeading` and `sectionAnchor` metadata. Generate one rewrite suggestion per affected section, not per chunk.

**Prompt structure:** The LLM receives:
1. The full current section text (reassembled from chunks for that section)
2. The specific code changes that affect this section (diff excerpts from grounded detection)
3. The staleness explanation from the detector
4. The existing page's wiki markup format (MediaWiki wikitext or HTML-derived markdown)
5. Instructions to output structured JSON

**Output format:**
```typescript
type SectionRewrite = {
  sectionHeading: string;
  sectionAnchor: string;
  currentExcerpt: string;      // first ~200 chars of current text
  suggestedText: string;       // full replacement text for the section
  changeRationale: string;     // one-sentence explanation grounded in diff evidence
  confidence: "high" | "medium" | "low";
};
```

**LLM task type:** New task type `wiki-rewrite` in the task router. Route to a capable generation model (Claude Sonnet or equivalent via Vercel AI SDK). This is a generation task requiring accuracy, not a classification task.

**Guardrails:**
- Apply v0.24 epistemic boundaries: the LLM should only suggest changes grounded in the diff evidence, not inject external knowledge.
- If the LLM cannot determine what the correct new content should be from the diff, it should flag the section as "needs manual review" with the evidence, rather than hallucinating replacement text.
- Cap rewrites at the section level -- never suggest restructuring the entire page.
- Include the raw diff as evidence in the output so humans can verify the suggestion.

**Token budget per page:** Approximately 4000 tokens input (wiki content + diff excerpts + prompt) and 2000 tokens output (rewrite suggestions). For 20 pages, this is roughly 120K tokens total -- well within model limits and cost-acceptable.

**Complexity:** High. This is the most complex feature. Prompt engineering for accurate wiki rewrites, structured output parsing, quality filtering, and handling edge cases (pages where diffs don't clearly indicate what changed) all require careful implementation.

### 6. Batch Publishing to GitHub Issues

**Goal:** Create a tracking issue in xbmc/wiki repo, post per-page update suggestions as comments.

**Architecture:**
```
Pipeline output (top 20 pages with rewrites)
  --> Create one tracking issue in xbmc/wiki
  --> Post one comment per page with section-level suggestions
  --> Rate-limit comment creation
```

**Issue structure:**
- Title: `Wiki Content Update Suggestions - {YYYY-MM-DD}`
- Body: Summary table listing all pages with staleness confidence, section count, and links
- Labels: `bot-generated`, `wiki-update` (create if not exist)

**Comment format per page:**
```markdown
## {Page Title}

**Staleness confidence:** {High/Medium}
**Evidence:** {one-line from grounded detector}
**Page URL:** {wiki URL}

### Section: {heading}

**What changed in code:** {changeRationale from rewrite}

<details>
<summary>Current text (excerpt)</summary>

{currentExcerpt}

</details>

<details>
<summary>Suggested update</summary>

{suggestedText}

</details>

---
```

**Rate limiting:** GitHub REST API allows 5000 requests/hour for authenticated apps. Creating 20+ comments sequentially with 1.5-second delays (matching existing backfill pattern) is safe. Total time: approximately 30 seconds.

**Idempotency:** Search for existing issue with matching title before creating. Use `octokit.issues.listForRepo({ creator: 'kodiai[bot]', state: 'open' })` filtered by title prefix. If found, append new comments rather than creating duplicate issues.

**Error handling:** If comment creation fails for one page, log the error and continue with remaining pages. Post a summary comment at the end noting any failures.

**Complexity:** Medium. Straightforward GitHub API usage. The formatting of structured rewrite suggestions into readable markdown comments is the main effort.

---

## Anti-Features

Features to explicitly NOT build for v0.25.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-editing wiki pages | Far too risky. LLM rewrites may contain errors, and direct wiki edits bypass human review. PROJECT.md scope explicitly says "suggestions posted as GitHub issue comments." | Post suggestions as issue comments for human review and manual application. |
| Real-time staleness detection on every commit | Excessive API usage, noisy alerts. The existing weekly scheduled scan is the right cadence for this use case. | Keep weekly scheduled scan. The enhanced grounded detection makes each scan more valuable. |
| Multi-wiki support | Over-engineering for v0.25. Only kodi.wiki is in scope. | Hardcode kodi.wiki patterns; parameterize later if needed. |
| Interactive approval workflow | Slack buttons/modals or GitHub check-run approvals for applying rewrites. Adds significant UI complexity for a one-shot manual trigger. | One-shot generation, human reviews suggestions in the GitHub issue. |
| Citation frequency tracking (full implementation) | Building real-time citation counting requires instrumentation across all publish paths (review, mention, Slack). Over-scoped for v0.25 where the primary need is just ranking 20 pages. | Use inbound link count + edit recency as popularity proxy for v0.25. Add citation tracking as a follow-up. |
| Dual-index embedding migration | The wiki corpus is small (under 5000 chunks). Running parallel old/new indexes adds operational complexity for no benefit at this scale. | Atomic batch re-embed: re-embed all wiki chunks, then switch query model. Brief retrieval downtime is acceptable for a manual trigger. |
| PR-based wiki updates | Creating PRs against a wiki repo adds Git workflow complexity. MediaWiki wikis are not Git-backed. | GitHub issues with structured suggestion comments. |
| Full page rewrites | Rewriting entire pages risks introducing errors in sections that are NOT stale. Section-level granularity limits blast radius. | Section-by-section suggestions only for sections identified as stale. |

---

## Feature Dependencies

```
Per-corpus model selection ─┐
                            ├──> Embedding migration (wiki corpus)
voyage-context-3 research ──┘
                                    |
                                    v
Page popularity scoring ──────> Top 20 page selection
                                    |
                                    v
Code-grounded staleness ──────> Enhanced staleness pipeline
                                    |
                                    v
                           LLM rewrite generation
                                    |
                                    v
                           Batch publish to GitHub issues
```

**Critical path:** Embedding migration and per-corpus model selection must happen first because they affect retrieval quality for the entire pipeline. Page popularity scoring and code-grounded staleness can be developed in parallel after migration. Rewrite generation depends on both (needs to know WHICH pages and WHY they are stale). Publishing is the final step.

**Parallel opportunities:**
- Per-corpus model selection + embedding migration can be one phase (tightly coupled).
- Page popularity scoring and code-grounded staleness enhancement are independent and can be developed in parallel.
- Rewrite generation + publishing are sequential but could be one phase.

---

## MVP Recommendation

**Phase 1 -- Foundation:**
1. Per-corpus embedding model selection in retrieval
2. Wiki corpus embedding migration to voyage-context-3 (batch script + wiki-sync update)

**Phase 2 -- Intelligence (parallelizable internally):**
3. Page popularity scoring (inbound links + edit recency)
4. Code-grounded staleness detection (diff excerpt extraction + enhanced LLM prompt)

**Phase 3 -- Generation and Delivery:**
5. LLM-generated section-by-section rewrite suggestions
6. Batch publishing to GitHub issues with structured comments

**Defer from v0.25:**
- Retrieval citation frequency tracking: requires broad instrumentation across publish paths. Use link count as proxy.
- View count integration: blocked by kodi.wiki lacking PageViewInfo extension. Revisit if extension is installed later.

---

## Complexity Estimates

| Feature | Complexity | Rationale |
|---------|------------|-----------|
| Per-corpus model selection | Low-Medium | Plumbing change: thread corpus-specific providers through retriever factory. ~100-150 lines across 3-4 files. |
| Embedding migration | Medium | Batch re-embed script + wiki-sync update + provider wiring. Script ~150 lines, sync changes ~30 lines. |
| Page popularity scoring | Medium | MediaWiki API for inbound links (~100 lines), scoring/ranking logic (~100 lines), top-20 selection. |
| Code-grounded staleness | Medium-High | Diff extraction from existing commit data (~100 lines), hunk filtering/budgeting (~80 lines), enhanced LLM prompt (~50 lines), integration (~50 lines). |
| LLM rewrite generation | High | Prompt engineering, structured output parsing, quality filtering, per-section processing. ~300-400 lines. |
| Batch publishing | Medium | Issue creation, comment formatting, rate limiting, idempotency. ~200-250 lines. |

---

## Risk Assessment

| Feature | Risk | Mitigation |
|---------|------|------------|
| Embedding migration | Voyage-context-3 API availability or breaking changes | First 200M tokens free; wiki corpus is tiny. Verify API access in Phase 1 before committing. |
| Page popularity | No view count API on kodi.wiki | Fall back to inbound link count + edit recency. Both available via standard MediaWiki API (`prop=linkshere`, existing `last_modified`). |
| Code-grounded staleness | Diff excerpts may exceed LLM context budget | Budget diff content per page (~2000 tokens). Prioritize hunks with wiki keyword overlap. Truncate gracefully. |
| LLM rewrites | Generated text may not match wiki formatting conventions | Include wiki markup examples in prompt. Post-process to validate basic structure. Human review catches formatting issues. |
| LLM rewrites | Hallucinated content in suggestions | Apply epistemic guardrails from v0.24. Only suggest changes grounded in diff evidence. Flag uncertain sections as "needs manual review." |
| Batch publishing | GitHub API rate limits | 20 comments with 1.5s delays = ~30 seconds total. Well within 5000 req/hr limit. |
| Batch publishing | xbmc/wiki repo may not have issues enabled | Verify issues are enabled on xbmc/wiki before Phase 3. Fall back to xbmc/xbmc if needed. |

---

## Sources

- Voyage AI embeddings documentation: https://docs.voyageai.com/docs/embeddings (HIGH confidence)
- Voyage-context-3 announcement: https://blog.voyageai.com/2025/07/23/voyage-context-3/ (HIGH confidence)
- MediaWiki PageViewInfo extension: https://www.mediawiki.org/wiki/Extension:PageViewInfo (HIGH confidence)
- Kodi wiki API verification: kodi.wiki/api.php?action=query&prop=pageviews -- returns "Unrecognized value" confirming PageViewInfo is not installed (HIGH confidence, directly verified)
- Embedding migration patterns: https://medium.com/data-science-collective/different-embedding-models-different-spaces (MEDIUM confidence)
- Zero-downtime embedding migration: https://dev.to/humzakt/zero-downtime-embedding-migration (MEDIUM confidence)
- Existing codebase analysis: wiki-staleness-detector.ts, wiki-store.ts, embeddings.ts, wiki-retrieval.ts, retrieval.ts, wiki-types.ts, wiki-sync.ts, config.ts, index.ts (HIGH confidence, directly read)

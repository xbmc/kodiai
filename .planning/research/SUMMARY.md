# Project Research Summary

**Project:** Kodiai v0.25 — Wiki Content Updates
**Domain:** Wiki content maintenance automation (embedding migration, page popularity, staleness detection, LLM rewrite suggestions, GitHub issue publishing)
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

v0.25 extends an existing AI-powered code review bot with a wiki content update pipeline. The pipeline identifies stale Kodi wiki pages via enhanced staleness detection grounded in real code diffs, generates section-level rewrite suggestions using an LLM with evidence citations, and publishes those suggestions as comments on a tracking issue in the xbmc/wiki GitHub repository. The recommended approach builds entirely on already-installed dependencies — no new packages are needed. The single most important architectural change is migrating wiki embeddings from voyage-code-3 to voyage-context-3 (a prose-optimized contextualized embedding model), which must happen atomically before any retrieval queries use the new model. The `voyageai@0.1.0` SDK already exposes `contextualizedEmbed()` and all Octokit patterns needed for GitHub publishing are proven in the existing codebase.

The work maps to five sequential phases that follow a hard dependency chain: embedding migration must come first because all wiki retrieval in later phases depends on consistent vector spaces; page popularity scoring comes second to drive the top-20 page selection that focuses the staleness detector; enhanced staleness detection provides the diff-grounded evidence that the LLM rewrite generator requires; and publishing is the final delivery step. Two significant constraints were confirmed through direct API testing: kodi.wiki does NOT have the PageViewInfo extension installed (MediaWiki pageview counts are unavailable and must be replaced with inbound link counts plus retrieval citation frequency), and voyage-context-3 uses a fundamentally different batched API format that requires a new `ContextualizedEmbeddingProvider` interface rather than a drop-in model name change.

The primary risks are LLM hallucination in rewrite suggestions and GitHub secondary rate limit violations during batch comment posting. Both have clear mitigations rooted in existing codebase patterns: grounding every suggestion in verified diff content with explicit commit citations (extending v0.24 epistemic guardrails), and enforcing minimum 3-second delays between comment posts with exponential backoff on 403 responses. The existing staleness heuristic's high false positive rate (common Kodi tokens like "player" and "video" match most wiki pages and source files) must also be addressed before feeding heuristic results into automated publishing.

---

## Key Findings

### Recommended Stack

All dependencies required for v0.25 are already installed. The `voyageai@0.1.0` package already exposes `client.contextualizedEmbed()` with full TypeScript types (verified in `node_modules/voyageai/Client.d.ts`). Octokit's `rest.issues.create` and `rest.issues.createComment` are already used throughout the codebase. The Vercel AI SDK's `generateWithFallback()` handles LLM generation. No `npm install` commands are needed. See [STACK.md](STACK.md) for full API specifications and verified type definitions.

The key integration subtlety: voyage-context-3 uses `POST /v1/contextualizedembeddings` (not `/v1/embeddings`) with `inputs: string[][]` (all chunks for one document as one inner array) and returns nested responses (`response.data[i].data[j].embedding`). This incompatibility with the current `EmbeddingProvider.generate(text, inputType)` interface requires a new `ContextualizedEmbeddingProvider` that takes all chunks for a page at once. The existing single-text provider is retained for all four non-wiki corpora and for wiki query embeddings.

**Core technologies:**
- `voyageai@0.1.0` (`contextualizedEmbed()`): wiki document embedding — already installed, SDK types verified, no upgrade needed
- `@octokit/rest` (`issues.create`, `issues.createComment`): GitHub publishing — same auth and retry patterns as existing issue-comment-server.ts
- Vercel AI SDK (`generateWithFallback()`): LLM rewrite generation — new `WIKI_UPDATE_SUGGESTION` task type needed in task-types.ts
- `postgres.js`: popularity aggregation queries — no new tables except `wiki_page_popularity`
- MediaWiki HTTP API (`fetch()`): inbound link counts via `prop=linkshere` — no pageview extension available on kodi.wiki

**Critical version note:** voyage-context-3 and voyage-code-3 both produce 1024-dimensional vectors. pgvector accepts them in the same column without schema errors. However, vectors from different models occupy different semantic spaces — cosine similarity across model boundaries is meaningless. Migration must be fully atomic.

### Expected Features

**Must have (table stakes):**
- **Embedding migration to voyage-context-3** — wiki is prose content; voyage-code-3 is code-optimized. Without migration, the entire pipeline operates on suboptimal embeddings. All wiki chunks must be migrated before switching the query model.
- **Code-grounded staleness detection** — current heuristic (file-path token overlap) produces too many false positives to feed into automated publishing. Real diff content from already-available `commit.files[].patch` must be included in the LLM evaluation prompt.
- **LLM-generated section-level rewrite suggestions** — the core deliverable. Section granularity aligns with existing wiki chunking from `wiki-chunker.ts`. Full-page rewrites are explicitly an anti-feature (higher hallucination risk, harder to verify).
- **Batch publishing to GitHub issues** — xbmc/wiki repo confirmed private with issues enabled (4 existing issues); one tracking issue per run, one comment per stale page.

**Should have (differentiators):**
- **Page popularity scoring** — ensures effort focuses on the most-used pages. Inbound link count (MediaWiki `prop=linkshere`) weighted 0.3 plus retrieval citation frequency weighted 0.7, stored in new `wiki_page_popularity` table.
- **Per-corpus embedding model selection** — wiki uses voyage-context-3; code, review comments, issues, and snippets keep voyage-code-3. Requires threading a second `EmbeddingProvider` through `createRetriever()`.

**Defer to post-v0.25:**
- Retrieval citation frequency tracking: cold-start problem makes it meaningless for the first pipeline run; use inbound link count as proxy.
- MediaWiki pageview counts: PageViewInfo extension is not installed on kodi.wiki; confirmed via direct API probe.
- Auto-editing wiki pages: out of scope per PROJECT.md — suggestions only, human applies them.
- Interactive approval workflow: over-scoped; one-shot manual trigger with GitHub issue review is sufficient.
- Dual-index embedding migration: wiki corpus is under 5000 chunks; atomic batch re-embed is simpler and sufficient.

### Architecture Approach

The pipeline extends four existing components (EmbeddingProvider, WikiPageStore, WikiStalenessDetector, TASK_TYPES) and adds four new modules (wiki-embedding-migrator.ts, wiki-popularity.ts, wiki-update-generator.ts, wiki-issue-publisher.ts). The entire pipeline runs as a single orchestrated function with a manual trigger. Data flows sequentially: popularity scoring selects top-20 pages, enhanced staleness detection evaluates them with diff evidence, the update generator produces section-level suggestions, and the publisher posts them to xbmc/wiki. One new DB migration is required (`020-wiki-page-popularity.sql`). No schema changes to `wiki_pages` — the `embedding_model` column already exists. See [ARCHITECTURE.md](ARCHITECTURE.md) for full component diagram, data flows, and anti-patterns.

**Major components:**
1. **ContextualizedEmbeddingProvider** — new interface wrapping `contextualizedEmbed()` for batch document re-embedding; existing single-text `EmbeddingProvider` retained for all non-wiki corpora and wiki query embedding
2. **wiki-popularity.ts** — computes `(citation_count * 0.7) + (link_in_count * 0.3)` per page, stored in `wiki_page_popularity` table; citation tracking is fire-and-forget after retrieval, following hunk-embedding pattern in code-snippet-chunker.ts
3. **wiki-update-generator.ts** — new `WIKI_UPDATE_SUGGESTION` task type; outputs `SectionRewrite[]` with commit citations; applies diff-grounded vs inferred classification for epistemic guardrails
4. **wiki-issue-publisher.ts** — creates one tracking issue in xbmc/wiki, posts one comment per page, enforces 3-second delays between posts, implements idempotency via title-based dedup

**Key architectural pattern — per-corpus provider injection:**
```typescript
export function createRetriever(deps: {
  embeddingProvider: EmbeddingProvider;       // voyage-code-3 (default)
  wikiEmbeddingProvider?: EmbeddingProvider;  // voyage-context-3 (wiki)
  // ...
})
```

### Critical Pitfalls

Top pitfalls from [PITFALLS.md](PITFALLS.md):

1. **Mixed embedding models break retrieval silently** — Both models produce 1024-dim vectors, so pgvector accepts them in the same column without error. But cosine similarity across model boundaries is meaningless. Migration must null out all wiki embeddings, re-embed completely, then switch query model. Verify: `SELECT COUNT(DISTINCT embedding_model) FROM wiki_pages WHERE deleted = false` must equal 1. Address in Phase 1.

2. **kodi.wiki has no PageViewInfo extension** — The Wikimedia REST pageview API is inapplicable to self-hosted MediaWiki instances. Confirmed via direct API probe: `?action=query&prop=pageviews` returns "Unrecognized value." Must use `prop=linkshere` plus edit recency as popularity proxy. Address in Phase 2.

3. **LLM hallucination in rewrite suggestions** — Without actual diff content, the LLM fabricates version numbers, API names, and config keys with high confidence. Every suggestion must be grounded in a specific commit SHA and file change. Classify suggestions as "diff-grounded" vs "inferred" and only publish diff-grounded ones. Address in Phase 4.

4. **GitHub secondary rate limit on batch comment posting** — Posting 20 comments rapidly to a single issue triggers GitHub's abuse detection (distinct from primary rate limit). Requires minimum 3-second delays, exponential backoff on 403s, and a circuit breaker after 2 consecutive secondary-limit failures. Address in Phase 5.

5. **Staleness false positives from token-overlap heuristic** — Common Kodi tokens ("player", "video", "audio", "addon", "skin") appear in most wiki pages and most source file paths. Current threshold (score >= 1) is too permissive. Must raise to score >= 3 and add a domain stopword list before feeding results into the LLM pipeline. Address in Phase 3.

---

## Implications for Roadmap

The confirmed feature dependency chain maps directly to a five-phase structure. Each phase has a hard dependency on the previous:

```
Phase 1 (Embedding Migration)       — wiki corpus uses voyage-context-3
    ↓
Phase 2 (Page Popularity)           — top-20 page list
    ↓
Phase 3 (Enhanced Staleness)        — stale pages with diff evidence
    ↓
Phase 4 (LLM Rewrite Generation)    — section-level suggestions with citations
    ↓
Phase 5 (GitHub Issue Publishing)   — tracking issue + per-page comments
```

### Phase 1: Embedding Migration and Per-Corpus Routing

**Rationale:** Must come first. All wiki retrieval in later phases depends on consistent vector spaces. Mixed-model vectors in pgvector is the highest-severity silent failure mode (Pitfall 1 — critical). Retrieval quality improvement from voyage-context-3 benefits all phases from Phase 2 onward.

**Delivers:** Wiki corpus re-embedded with voyage-context-3; retrieval pipeline routes wiki queries to the correct model; all other corpora (code, review comments, issues, snippets) unchanged; wiki-sync.ts updated to use contextualized embedding for future ingest.

**Addresses (FEATURES.md):** Embedding migration (table stakes), per-corpus model selection (differentiator).

**Avoids (PITFALLS.md):** Mixed-model vector search (Pitfall 1 — null out all wiki embeddings first, complete re-embed batch atomically, then enable retrieval); implicit dimension assumption (always specify `outputDimension: 1024` explicitly in API calls).

**Stack:** `voyageai@0.1.0` `contextualizedEmbed()` with `inputs: string[][]`; new `ContextualizedEmbeddingProvider` interface; migration script `wiki-embedding-migrator.ts` batching chunks by page; update `createRetriever()` to accept `wikiEmbeddingProvider` parameter.

### Phase 2: Page Popularity Ranking

**Rationale:** Must come before staleness detection to drive top-20 page selection. Without principled ranking, the staleness detector defaults to recency-sorted pages dominated by common-token noise, and LLM evaluation budget is wasted on low-signal pages.

**Delivers:** `wiki_page_popularity` table with computed scores; top-N ranked page list as input to staleness detection; DB migration 020.

**Addresses (FEATURES.md):** Page popularity scoring (differentiator).

**Avoids (PITFALLS.md):** Wikimedia REST API misuse (Pitfall 2 — use `prop=linkshere` for inbound links, not Wikimedia pageview endpoint); all-zero popularity scores on cold start (combine link count with edit recency from existing `last_modified` column to ensure non-trivial ranking from day one).

**Stack:** MediaWiki HTTP API `prop=linkshere` (available on all MediaWiki instances, no extensions required); fire-and-forget citation increment after `createRetriever()` returns results; new `wiki_page_popularity` table.

**Research flag:** Citation tracking integration requires identifying the correct hook point in the retrieval pipeline. The fire-and-forget pattern is established (code-snippet-chunker.ts precedent), but the specific location in `cross-corpus-rrf.ts` or `createRetriever()` output needs a careful read to avoid blocking the response path.

### Phase 3: Enhanced Staleness Detection

**Rationale:** The existing token-overlap heuristic produces too many false positives when its output feeds automated publishing rather than a human-reviewed Slack report (Pitfall 5). Must improve precision before LLM generation, or the update generator wastes tokens on non-stale pages.

**Delivers:** Enhanced `StalePage[]` with diff excerpts and PR context; heuristic threshold raised to score >= 3 with domain stopwords; LLM evaluation grounded in actual code changes from already-available `commit.files[].patch`.

**Addresses (FEATURES.md):** Code-grounded staleness detection (table stakes).

**Avoids (PITFALLS.md):** Fetching full diffs for all commits (anti-pattern — fetch diff details only for commits that pass the heuristic filter; budget diff content at ~2000 tokens per candidate); heuristic false positives (Pitfall 5 — raise threshold, add stopwords, weight section-heading matches higher than body text matches).

**Stack:** Existing `octokit.repos.getCommit()` already returns `patch` per file but currently discards it; extend `CommitWithFiles` type to include `patch_summary`; add `octokit.repos.listPullRequestsAssociatedWithCommit()` for PR title/description context.

**Research flag:** Standard patterns — no additional research needed. The enhancement is additive to well-understood code. However, Phase 3 should include a calibration run against 30 days of historical commits to validate that >=50% of top-20 candidates are confirmed stale by the LLM before connecting to Phase 4.

### Phase 4: LLM Rewrite Generation

**Rationale:** Depends on Phase 3's diff-grounded staleness output. The most complex phase. Prompt engineering for accurate wiki rewrites requires careful design and a dry-run validation step before connecting to the publishing pipeline.

**Delivers:** `UpdateSuggestion[]` per stale page, each with per-section `SectionRewrite` entries; every suggestion includes a commit SHA and file path citation; suggestions classified as "diff-grounded" vs "inferred"; only diff-grounded suggestions are marked for publishing.

**Addresses (FEATURES.md):** LLM-generated section-level rewrite suggestions (table stakes).

**Avoids (PITFALLS.md):** Hallucinated technical details (Pitfall 3 — provide actual diff content not just file paths; frame output as "suggested changes with evidence" not "rewritten content"; apply v0.24 epistemic guardrails adapted for prose); full-page rewrites (anti-feature — cap suggestions at section level).

**Stack:** New `WIKI_UPDATE_SUGGESTION` task type in `src/llm/task-types.ts`; `generateWithFallback()` with structured JSON output; prompt includes diff excerpts from Phase 3 output.

**Research flag:** Prompt engineering for diff-grounded suggestions is novel territory for this codebase. The v0.24 output filter and claim classification patterns are the closest precedent but were designed for PR review findings. Recommend implementing a dry-run mode (generate suggestions, log them, do NOT pass to publisher) and manually reviewing 10+ suggestions before enabling end-to-end pipeline.

### Phase 5: GitHub Issue Publishing

**Rationale:** Final delivery step. Pure integration work — no new LLM or retrieval logic. Depends entirely on Phase 4 output.

**Delivers:** One tracking issue per pipeline run in xbmc/wiki, one comment per stale page, idempotent (title-based dedup prevents duplicate issues on re-runs).

**Addresses (FEATURES.md):** Batch publishing to GitHub issues (table stakes).

**Avoids (PITFALLS.md):** GitHub secondary rate limit (Pitfall 4 — minimum 3-second delays, exponential backoff on 403, circuit breaker after 2 consecutive failures); single mega-comment for all pages (anti-pattern — one comment per page, check 65K char limit before posting); GitHub App not installed on xbmc/wiki (pre-flight check `GET /repos/xbmc/wiki/installation` before any publishing attempt).

**Stack:** New `wiki-issue-publisher.ts` using existing Octokit patterns from issue-comment-server.ts; reuse `enforceMaxLength()` and retry logic; `getInstallationOctokit()` from `src/auth/github-app.ts` with xbmc/wiki installation ID.

**Research flag:** Standard patterns (rate-limit-aware Octokit calls are well-established in the codebase). No additional research needed, but requires E2E test against a real test repo before running against xbmc/wiki to confirm GitHub App installation and comment rendering.

### Phase Ordering Rationale

- **Embedding migration must be Phase 1** because all wiki retrieval in later phases depends on consistent vector spaces. Running popularity scan or staleness detection with mismatched query/document models produces silent garbage with no visible errors.
- **Popularity before staleness** because the staleness detector's 20-page LLM evaluation cap should be spent on the most important pages, not the most-recently-touched ones.
- **Staleness before generation** because the generator's quality depends entirely on having diff excerpts and PR context from the staleness pipeline as grounding evidence.
- **Generation before publishing** because publishing is pure output formatting — it has no logic of its own beyond formatting and rate-limiting.
- **Parallel opportunity within phases:** Per-corpus embedding routing wiring and the migration script itself are largely independent and can be developed in parallel within Phase 1. Page popularity MediaWiki API calls and citation tracking fire-and-forget logic can be developed in parallel within Phase 2.

### Research Flags

Phases needing deeper design work before implementation:
- **Phase 1:** The `ContextualizedEmbeddingProvider` interface design needs a careful read of all existing `EmbeddingProvider` consumers to ensure the two-provider wiring in `createRetriever()` doesn't silently pass the wrong provider to any corpus search function.
- **Phase 4:** LLM prompt engineering for diff-grounded wiki section rewrites is novel for this codebase. Recommend implementing dry-run mode and manually reviewing output before enabling end-to-end pipeline. The diff-grounded vs inferred classification schema needs explicit design before writing any generation code.

Phases with standard patterns (skip research-phase):
- **Phase 2:** MediaWiki `prop=linkshere` is well-documented and simple. Fire-and-forget citation tracking follows the exact pattern in code-snippet-chunker.ts.
- **Phase 3:** Extending `CommitWithFiles` with patch summaries and adding PR association lookups are additive changes to well-understood code with clear precedents.
- **Phase 5:** Octokit issue creation and comment posting patterns are used throughout the codebase. Rate-limit handling follows GitHub's documented secondary limit behavior.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new packages needed; all SDK types verified in node_modules; voyage-context-3 API format confirmed against installed TypeScript definitions; xbmc/wiki repo confirmed via `gh api`; STACK.md includes verified code samples |
| Features | HIGH | Feature set verified against existing codebase; kodi.wiki PageViewInfo absence confirmed via direct API probe; dependency graph derived from direct code analysis of wiki-store.ts, embeddings.ts, retrieval.ts, wiki-staleness-detector.ts |
| Architecture | HIGH | Architectural decisions derived from reading actual source files; two-provider approach follows existing retriever factory pattern; DB schema verified (embedding_model column already exists); new wiki_page_popularity table schema is straightforward |
| Pitfalls | HIGH | Pitfalls 1 and 2 verified directly (pgvector behavior with same-dimension different-model vectors; kodi.wiki API response confirming no pageview extension); Pitfalls 3-5 derived from v0.24 incident record, GitHub API official docs, and existing codebase rate-limit handling |

**Overall confidence:** HIGH

### Gaps to Address

- **GitHub App installation on xbmc/wiki:** Unverified whether the Kodiai GitHub App is installed on xbmc/wiki (as opposed to just xbmc/xbmc). Must verify before Phase 5 implementation begins. Low-effort fix if missing (one-click in GitHub App settings), but must not be discovered at publishing time. Add pre-flight check as first task in Phase 5.

- **voyage-context-3 free tier token budget:** Research confirms 200M free tokens and wiki corpus under 5000 chunks, but the precise token count for the migration batch is unknown. Measure during Phase 1 before committing to the full re-embed — unexpected token usage could exhaust the free tier.

- **Staleness heuristic threshold tuning:** The recommendation to raise threshold from score >= 1 to score >= 3 is based on vocabulary analysis, not empirical testing against actual Kodi commit history. Phase 3 must include a calibration run before connecting to the LLM pipeline.

- **PR association API coverage:** `octokit.repos.listPullRequestsAssociatedWithCommit()` depends on GitHub having indexed the PR-commit association. For commits older than 30 days, associations may be absent. Phase 3 must handle gracefully when no associated PR is found (use diff excerpts only, omit PR title/description from prompt).

---

## Sources

### Primary (HIGH confidence)
- Voyage AI Contextualized Embeddings Docs: https://docs.voyageai.com/docs/contextualized-chunk-embeddings — API format, batch structure, limits
- Voyage AI Pricing: https://docs.voyageai.com/docs/pricing — $0.18/1M for both models; 200M free tier
- `node_modules/voyageai/Client.d.ts` — `contextualizedEmbed()` SDK method verified in repo
- `gh api repos/xbmc/wiki` — confirmed private, issues enabled, 4 existing issues
- `kodi.wiki/api.php?action=query&prop=pageviews` — confirmed "Unrecognized value" response (PageViewInfo absent)
- `kodi.wiki/api.php?action=query&meta=siteinfo&siprop=extensions` — confirmed Google Analytics Integration v3.0.1 installed, no PageViewInfo or HitCounters
- Existing codebase (wiki-store.ts, wiki-staleness-detector.ts, embeddings.ts, retrieval.ts, cross-corpus-rrf.ts, issue-comment-server.ts, wiki-sync.ts, code-snippet-chunker.ts, index.ts) — all patterns verified by direct read
- GitHub REST API Rate Limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

### Secondary (MEDIUM confidence)
- voyage-context-3 Blog Post: https://blog.voyageai.com/2025/07/23/voyage-context-3/ — 14.24% retrieval improvement on chunk-level tasks
- MediaWiki Extension:PageViewInfo — confirmed Wikimedia-infrastructure dependency; inapplicable to self-hosted instances
- MediaWiki Extension:HitCounters — alternative for self-hosted wikis; no API endpoint, only Special:PopularPages HTML
- Zero-downtime embedding migration patterns — atomic batch approach for small corpora

### Tertiary (LOW confidence / needs validation during execution)
- GitHub secondary rate limit behavior for batch comment posting — 3-second delay recommendation from community experience, not official documentation; must validate with E2E test before production use
- Staleness heuristic threshold recommendation (score >= 3) — derived from Kodi vocabulary analysis, not empirical testing against real commit history

---
*Research completed: 2026-03-02*
*Ready for roadmap: yes*

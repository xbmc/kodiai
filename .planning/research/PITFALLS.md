# Pitfalls Research

**Domain:** Adding wiki content update pipeline (embedding migration, page popularity, enhanced staleness, LLM rewrite suggestions, GitHub issue publishing) to existing AI-powered code review bot
**Researched:** 2026-03-02
**Confidence:** HIGH (verified against existing codebase, official API docs, and Voyage AI documentation)

---

## Critical Pitfalls

### Pitfall 1: Mixed Embedding Models in the Same pgvector Column Break Retrieval

**What goes wrong:**
After migrating wiki page embeddings from `voyage-code-3` to `voyage-context-3`, the `wiki_pages` table contains a mix of old voyage-code-3 vectors and new voyage-context-3 vectors in the same `embedding vector(1024)` column. Both models output 1024-dimensional vectors (same column size, no schema error), so pgvector happily computes cosine distances between them. But vectors from different models occupy different semantic spaces -- a cosine distance of 0.3 between two voyage-code-3 vectors means something entirely different from 0.3 between a voyage-code-3 vector and a voyage-context-3 vector. The HNSW index will silently return garbage rankings mixing both vector types, and retrieval quality degrades without any visible error.

**Why it happens:**
The dimension match (both models default to 1024) creates a false sense of compatibility. pgvector has no concept of "embedding model" -- it treats all 1024-dim vectors identically. Developers assume migration is a simple matter of re-embedding and inserting new vectors, but forget that any row NOT re-embedded still has an old-model vector. The `embedding_model` column exists in the schema (see `wiki-store.ts` line 37, 87, 131) but is currently hardcoded to `"voyage-code-3"` and is never used as a filter in queries.

**How to avoid:**
1. Re-embed ALL wiki page chunks in a single batch migration, not incrementally. The wiki corpus is bounded (~5000 chunks per the heuristic pass limit) so this is feasible.
2. Use the existing `embedding_model` column as a migration gate: UPDATE all rows to set `embedding = NULL, embedding_model = NULL` before re-embedding, then filter `WHERE embedding IS NOT NULL` in queries (already done in `searchByEmbedding`).
3. Alternatively, do the migration atomically: re-embed all chunks into a staging table, then swap in a transaction (DELETE old + INSERT new).
4. Add a startup assertion that verifies all non-deleted wiki rows have the same `embedding_model` value.

**Warning signs:**
- Wiki retrieval results suddenly feel less relevant after partial migration
- `searchByEmbedding` returns wiki pages that have no semantic relationship to the query
- The `embedding_model` column shows mixed values: `SELECT DISTINCT embedding_model FROM wiki_pages WHERE deleted = false`

**Phase to address:**
Phase 1 (Embedding Migration) -- must be fully atomic before any retrieval changes.

---

### Pitfall 2: Kodi Wiki Lacks PageViewInfo -- the Wikimedia Pageview API Does Not Work Here

**What goes wrong:**
The v0.25 milestone specifies "Page popularity ranking combining MediaWiki API view counts with retrieval citation frequency." Developers will search for the MediaWiki pageviews API and find the Wikimedia REST API (`/metrics/pageviews/per-article/`), which is well-documented and easy to use. But that API is a Wikimedia Foundation service backed by their analytics pipeline -- it only works for wikimedia.org-hosted wikis (Wikipedia, Wiktionary, etc.). kodi.wiki is a self-hosted MediaWiki instance. I verified this directly: kodi.wiki's installed extensions include Google Analytics Integration v3.0.1 but NOT PageViewInfo, HitCounters, or any internal pageview tracking extension.

**Why it happens:**
The Wikimedia pageview API is the top result for "MediaWiki page views API" in every search. The distinction between "MediaWiki the software" and "Wikimedia the hosting platform" is subtle and easy to miss. Self-hosted MediaWiki instances have NO built-in pageview tracking at all -- it requires explicit extension installation.

**How to avoid:**
1. Do NOT attempt to use the Wikimedia REST API (`wikimedia.org/api/rest_v1/metrics/pageviews`). It will return 404 for kodi.wiki pages.
2. The only viable pageview signal is Google Analytics if the Kodi team has GA configured and provides API access (requires GA property ID + credentials). This is likely out of scope.
3. Fall back to a proxy metric: retrieval citation frequency (how often each wiki page appears in retrieval results) is already trackable from the existing cross-corpus retrieval pipeline. Combine with: (a) number of incoming wiki internal links (can be extracted from the already-ingested wiki content), (b) page revision count / edit recency from the MediaWiki API (`prop=revisions`), (c) the staleness detector's heuristic score history.
4. Make the architecture accept pluggable popularity sources so GA can be added later without rework.

**Warning signs:**
- HTTP 404 or "not found" when hitting a pageviews endpoint
- Planning documents assume pageview data is readily available
- Sprint estimates for "popularity ranking" that only account for API integration, not alternative signal design

**Phase to address:**
Phase 2 (Page Popularity Ranking) -- must be redesigned around available signals before implementation begins.

---

### Pitfall 3: LLM-Generated Wiki Rewrite Suggestions Hallucinate Technical Details

**What goes wrong:**
When an LLM generates section-by-section rewrite suggestions for stale wiki pages, it will confidently fabricate version numbers, API names, configuration options, file paths, and code snippets that do not exist in the Kodi codebase. This is the exact same failure mode that motivated v0.24 (the PR #27932 incident where the bot fabricated libxkbcommon version numbers). The risk is amplified here because: (a) wiki rewrites are prose-heavy and harder to fact-check than code review comments, (b) the output is intended to be published to a tracking issue where maintainers might apply suggestions without verification, and (c) the LLM has access to wiki content but NOT the current codebase source files.

**Why it happens:**
The LLM sees stale wiki text + a list of changed file paths + staleness evidence, then extrapolates what the "correct" content should be. Without access to the actual new code, it fills gaps with plausible-sounding but fabricated specifics. The v0.24 epistemic guardrails (claim classification, severity demotion, output filtering) were designed for PR review findings, not for prose documentation rewrites -- they cannot be applied directly.

**How to avoid:**
1. Provide the LLM with the actual diff content (or at minimum the new file contents) for the relevant changed files, not just file paths. The staleness detector currently only passes `affectingFilePaths` -- the actual file content is not fetched.
2. Frame the LLM output as "suggested changes with evidence" not "rewritten content." Each suggestion should cite the specific code change that motivates it (commit SHA, file, relevant lines).
3. Apply a variant of the epistemic guardrails: classify each suggestion as "diff-grounded" (directly supported by provided code changes) vs "inferred" (extrapolated). Only publish diff-grounded suggestions; flag inferred ones with explicit caveats.
4. Include a prominent disclaimer on every published comment: "These suggestions are generated by AI and must be verified against the current codebase before applying."
5. Cap the scope of suggestions to what can be grounded: "Section X references `old_function()` which was renamed to `new_function()` in commit abc1234" rather than full prose rewrites.

**Warning signs:**
- Generated suggestions mention API endpoints, config keys, or version numbers not present in any provided context
- Suggestions confidently state what a function "now does" when only the function's file path (not content) was provided
- No diff evidence or commit citation accompanies a suggestion

**Phase to address:**
Phase 4 (LLM Rewrite Suggestions) -- must design the grounding pipeline before any generation code is written. The epistemic boundary patterns from v0.24 should be adapted, not bypassed.

---

### Pitfall 4: GitHub Secondary Rate Limits Block Batch Comment Posting

**What goes wrong:**
The publishing workflow needs to post up to 20 per-page update suggestion comments on a single tracking issue in xbmc/wiki. GitHub's secondary rate limit for content creation is 80 content-generating requests per minute (per GitHub official docs). Each comment is a POST request costing 5 points, and the 900 points/minute secondary limit means a theoretical max of 180 POST requests/minute. But the secondary rate limit is dynamic and undisclosed for specific endpoints -- posting 20 comments rapidly to a single issue triggers the abuse detection heuristic (rapid content creation on a single resource). The result is a 403 with "You have exceeded a secondary rate limit" after the 5th-10th comment, leaving the remaining pages without suggestions.

**Why it happens:**
The codebase already handles primary rate limits well (adaptive delays in backfill scripts, retry-after header parsing in review.ts). But secondary rate limits are specifically triggered by rapid content creation patterns, and posting 20 comments sequentially with small delays still looks like automated spam to GitHub's abuse detection. The existing rate limit handling in `review.ts` (lines 156-256) is focused on search API rate limits, not content creation.

**How to avoid:**
1. Add a minimum 3-second delay between comment posts. The 80/minute content creation limit suggests ~750ms minimum spacing, but real-world experience from GitHub community discussions shows 2-3 seconds is needed to avoid secondary triggers on a single resource.
2. Implement exponential backoff specifically for 403/429 responses with "secondary rate limit" in the message body. The existing `resolveRateLimitBackoffMs` helper in review.ts can be adapted.
3. Consider batching: instead of 20 separate comments, post fewer comments that each cover multiple pages (e.g., 4 comments of 5 pages each). This reduces the request count from 20 to 4.
4. Implement a circuit breaker: if 2 consecutive posts fail with secondary rate limit, pause all remaining posts and retry the batch after a 60-second cooldown.
5. Post the tracking issue first, then add comments with delays. If the tracking issue itself fails, abort gracefully.

**Warning signs:**
- 403 responses with "secondary rate limit" during the comment posting loop
- Only the first few pages get comments; the rest silently fail
- Testing against a test repo succeeds (low traffic) but production posting to xbmc/wiki fails (higher traffic, more scrutiny)

**Phase to address:**
Phase 5 (Publishing Workflow) -- must be implemented with rate-limit-aware posting from day one.

---

### Pitfall 5: Staleness False Positives from Token Overlap Heuristic Overwhelm Signal

**What goes wrong:**
The existing staleness detector (wiki-staleness-detector.ts) uses a token-overlap heuristic that splits wiki chunk text and changed file paths into tokens, then counts matches. Common Kodi-specific tokens like "player", "video", "audio", "settings", "addon", "skin", "music", "library" appear in dozens of wiki pages AND hundreds of source files. A commit touching `xbmc/video/PlayerController.cpp` will flag every wiki page mentioning "player" or "video" -- which is most of the wiki. The heuristic currently requires only score >= 1 for medium tier, so almost any commit flags many pages. The LLM cap of 20 pages per cycle prevents runaway costs but means the 20 most-recently-touched pages get evaluated instead of the 20 most-likely-stale pages.

For v0.25's "enhanced staleness analysis using recent PRs/commits as ground truth," this false positive rate means the top-20 page selection is dominated by noise, and the LLM-generated suggestions will target pages that aren't actually stale.

**Why it happens:**
The heuristic was designed as a cheap first-pass filter for the Slack staleness report (v0.20), where a human reviews the output. For v0.25, the output feeds directly into LLM rewrite generation and issue publishing -- the bar for precision must be much higher. The token overlap approach cannot distinguish between "this wiki page documents the player subsystem and a player file changed" (legitimate staleness signal) vs "this wiki page mentions video playback in passing and an unrelated video file changed" (false positive).

**How to avoid:**
1. Raise the heuristic threshold: require score >= 3 for inclusion (currently any score > 0 qualifies as "Medium" tier). The existing code already distinguishes "High" (>= 3) vs "Medium" but doesn't filter Medium out.
2. Weight section headings and page titles more heavily than body text tokens. A match on a heading is a stronger signal than a match buried in prose.
3. Use the already-available `section_heading` field to check whether the matching tokens appear in a section heading -- if so, boost the score significantly.
4. Filter common Kodi vocabulary: maintain a stopword list of domain-generic terms ("player", "video", "audio", "addon", "skin", "settings", "library", "kodi", "media") that should not count as token matches.
5. For the top-20 selection: sort by heuristic score (not recency) or use a combined score. Currently the detector sorts by `sortableRecencyMs` primary, `heuristicScore` secondary -- a recent commit changing one common-token file will push many low-quality matches to the top.

**Warning signs:**
- Most or all of the top-20 stale pages share the same triggering commit
- The same wiki pages appear in every staleness scan cycle
- LLM evaluation of heuristic-flagged pages consistently returns "CURRENT" (not stale)
- The `pagesEvaluated` vs stale pages ratio is very low (e.g., 20 evaluated, 1-2 actually stale)

**Phase to address:**
Phase 3 (Enhanced Staleness Analysis) -- must improve precision before feeding results into the LLM rewrite pipeline.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode `embedding_model` to `"voyage-code-3"` in wiki-store.ts | Simpler initial implementation | Migration requires touching store code; no model awareness at query time | Never after v0.25 -- must be parameterized |
| Skip re-embedding during migration (keep old vectors) | Faster migration | Silent retrieval quality degradation; mixed vector spaces | Never -- the entire point of migration is better vectors |
| Use file path tokens as sole staleness signal | Cheap, no API calls | High false positive rate drowns real staleness | Only for Slack reports where humans filter; not for automated publishing |
| Post all 20 comments in a tight loop | Simpler code, faster execution | Secondary rate limit blocks, partial publishing | Never -- always add delays for batch content creation |
| Generate full prose rewrites instead of targeted suggestions | More impressive-looking output | Higher hallucination risk, harder to verify, more likely to be wrong | Never for automated publishing -- grounded diffs only |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MediaWiki Action API (kodi.wiki) | Assuming `prop=pageviews` exists | kodi.wiki has no PageViewInfo extension. Use `prop=revisions` for edit frequency, `prop=links` for link graph, or Google Analytics if available. |
| MediaWiki Action API (kodi.wiki) | Not setting User-Agent header | Self-hosted wikis may still enforce User-Agent requirements. Always set a descriptive UA: `kodiai/0.25 (https://github.com/xbmc/kodiai)` |
| MediaWiki RecentChanges API | Using `rcend` incorrectly -- MediaWiki RC is reverse-chronological | The existing `wiki-sync.ts` handles this correctly (line 130 comment). Do not change the direction assumption when adding new API calls. |
| Voyage AI Embedding API | Assuming `voyage-context-3` uses a different API endpoint | Same `/embeddings` endpoint, just change the `model` parameter. But verify the response shape hasn't changed -- especially `output_dimension` parameter behavior. |
| Voyage AI Embedding API | Not specifying `output_dimension: 1024` explicitly | Both models default to 1024, but explicit is safer. If Voyage ever changes defaults, implicit reliance breaks silently. |
| GitHub Issues API (xbmc/wiki) | Assuming the bot has write access to xbmc/wiki repo | The GitHub App is installed on xbmc/xbmc. Verify installation covers xbmc/wiki. If not, issue creation will fail with 404/403. |
| GitHub Issues API | Creating an issue then immediately posting comments | The issue creation response includes the issue number. Use it immediately, but add a 1-second delay before the first comment to avoid secondary rate limit on the newly-created resource. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Re-embedding all wiki chunks synchronously on migration | Migration takes 30+ minutes, blocks other operations | Batch embeddings (Voyage AI supports batch API), run as background script not in-process | At ~5000 chunks with single-request embedding calls |
| Fetching full page content for all 20 candidate stale pages | Slow API round-trips, memory pressure | Fetch only the sections that are flagged as stale, not entire pages. The wiki-chunker already splits by section. | When pages are large (some Kodi wiki pages are 50KB+) |
| Storing LLM-generated suggestions as full text in issue comments | GitHub comments have a 65,536 character limit | Paginate or summarize. Check length before posting. | When a page has many stale sections producing verbose suggestions |
| Running staleness + rewrite + publishing in a single synchronous pipeline | One failure aborts everything; long execution time | Separate into: (1) identify stale pages, (2) generate suggestions (can be parallelized with delays), (3) publish. Persist intermediate state. | When any step fails partway through |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Publishing LLM-generated content that includes injected instructions from wiki page content | Prompt injection via wiki content leads to manipulated suggestions | Sanitize wiki content before including in LLM prompts. The existing TOCTOU protections and content sanitization from v0.1 should be applied to wiki content inputs. |
| Including raw file paths or code content in public issue comments | Leaks internal repository structure to public xbmc/wiki issue tracker | Only include file paths already visible in public commits. Never include file content in issue comments -- only describe changes. |
| Posting to wrong issue number due to race condition | Suggestions end up on unrelated issues | Create the tracking issue and immediately capture the number. Verify issue ownership before posting each comment. |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Posting 20 separate issue comments as a wall of text | Maintainers overwhelmed, ignore all suggestions | Group by priority/confidence. Post top 5 inline, rest collapsed or linked. Match the existing staleness report pattern (top 5 in summary, rest in thread). |
| Suggestions say "this section is outdated" without explaining what changed | Maintainers can't act on vague guidance | Every suggestion must cite the specific commit/PR that caused staleness and what specifically changed. |
| Rewriting entire sections instead of showing targeted diffs | Hard to review, easy to introduce new errors | Show before/after for the specific outdated parts only. Use markdown diff blocks or strikethrough formatting. |
| No way to dismiss or acknowledge a suggestion | Stale suggestions pile up in future runs | Include a reaction-based acknowledgment mechanism (thumbs up = applied, thumbs down = rejected) similar to the triage feedback loop from v0.23. |
| Running suggestions against draft/WIP wiki pages | Wastes effort on pages maintainers are already editing | Check `last_modified` recency -- if a page was edited within the last 7 days, skip it (someone may already be updating it). |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Embedding Migration:** All wiki rows show `embedding_model = 'voyage-context-3'` -- verify no NULL embeddings remain: `SELECT COUNT(*) FROM wiki_pages WHERE embedding IS NULL AND deleted = false`
- [ ] **Embedding Migration:** The retrieval pipeline actually uses the new model for query embedding, not just document embedding -- check that `embeddingProvider.generate()` calls use the correct model for wiki-type queries
- [ ] **Popularity Ranking:** The ranking works without pageview data -- verify the fallback signals (citation frequency, edit recency, link count) actually produce a meaningful ranking, not all-zeros
- [ ] **Staleness Enhancement:** The enhanced staleness correctly handles the case where a PR changes wiki-documented behavior but touches zero files with overlapping tokens -- test with a refactoring commit that renames functions
- [ ] **LLM Suggestions:** Each suggestion includes a commit SHA and file path citation -- verify citations are valid (the commit exists, the file path is correct) not hallucinated
- [ ] **Publishing:** The GitHub App installation covers the xbmc/wiki repository, not just xbmc/xbmc -- test issue creation before building the full pipeline
- [ ] **Publishing:** Comments render correctly in GitHub's markdown renderer -- test with actual markdown, especially code blocks and diff formatting
- [ ] **Publishing:** The workflow is idempotent -- running it twice doesn't create duplicate issues or duplicate comments
- [ ] **Rate Limiting:** The 20-comment posting completes without secondary rate limit errors on the real xbmc/wiki repo, not just a test repo

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Mixed embedding models in wiki_pages | MEDIUM | Run a query to identify mixed models: `SELECT DISTINCT embedding_model FROM wiki_pages WHERE deleted = false`. Set all embeddings to NULL, re-run migration script. ~30 min downtime for wiki retrieval. |
| Secondary rate limit during comment posting | LOW | Comments already posted are fine. Record which pages were posted (by index). Resume from the failed index after a 60-second wait. The idempotent design should skip already-posted pages. |
| Hallucinated content in published suggestions | HIGH | Cannot un-post without manual intervention. Must manually review each posted comment, edit or delete incorrect ones. Prevention is far cheaper than recovery. Consider a human-approval gate before publishing. |
| Staleness false positives generated bad suggestions | LOW-MEDIUM | The suggestions are per-page comments. Maintainers can simply ignore irrelevant ones. But repeated false positives erode trust in the tool. Fix the heuristic and re-run with improved precision. |
| Kodi wiki pageview API call fails (doesn't exist) | LOW | The feature degrades to citation-frequency-only ranking. No data loss. Redesign the popularity signal to use available metrics. |
| GitHub App not installed on xbmc/wiki | LOW | Install the app on xbmc/wiki. Or pivot to posting on xbmc/xbmc issues instead (the repo where the app IS installed). |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Mixed embedding models | Phase 1 (Embedding Migration) | `SELECT COUNT(DISTINCT embedding_model) FROM wiki_pages WHERE deleted = false` returns exactly 1 |
| Kodi wiki lacks PageViewInfo | Phase 2 (Page Popularity) | Design doc specifies alternative signals; no code references Wikimedia pageview API |
| Staleness false positives | Phase 3 (Enhanced Staleness) | Run enhanced detector against last 30 days of commits; >=50% of top-20 candidates are confirmed stale by LLM |
| LLM hallucination in rewrites | Phase 4 (LLM Suggestions) | Every published suggestion includes verifiable commit SHA + file path citation; manual review of 5 random suggestions finds zero fabricated details |
| GitHub secondary rate limit | Phase 5 (Publishing) | E2E test posting 20 comments to a test issue completes without 403/429 errors |
| Staleness false positives -> bad suggestions | Phase 3 + Phase 4 | Top-20 pages identified by enhanced staleness overlap >=60% with pages that actually have outdated content |
| Mixed embedding query model | Phase 1 (Embedding Migration) | Integration test verifies `embeddingProvider.generate()` uses `voyage-context-3` when embedding wiki-domain queries |
| GitHub App not installed on xbmc/wiki | Phase 5 (Publishing) | Pre-flight check: call `GET /repos/xbmc/wiki/installation` and verify non-404 response before any publishing |

## Sources

- Voyage AI Embeddings Documentation: https://docs.voyageai.com/docs/embeddings
- Voyage AI voyage-context-3 blog post: https://blog.voyageai.com/2025/07/23/voyage-context-3/
- GitHub REST API Rate Limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub Rate Limits for Apps: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps
- GitHub Secondary Rate Limit Discussion: https://github.com/orgs/community/discussions/50326
- MediaWiki PageViewInfo Extension: https://www.mediawiki.org/wiki/Extension:PageViewInfo
- MediaWiki API Etiquette: https://www.mediawiki.org/wiki/API:Etiquette
- Wikimedia API Rate Limits: https://api.wikimedia.org/wiki/Rate_limits
- OpenAI Community on pgvector Mixed Dimensions: https://community.openai.com/t/how-to-deal-with-different-vector-dimensions-for-embeddings-and-search-with-pgvector/602141
- Existing codebase: `src/knowledge/wiki-store.ts`, `src/knowledge/wiki-staleness-detector.ts`, `src/knowledge/retrieval.ts`, `src/handlers/review.ts`
- Direct API probe: kodi.wiki `api.php?action=query&meta=siteinfo&siprop=extensions` confirmed no PageViewInfo extension

---
*Pitfalls research for: v0.25 Wiki Content Updates*
*Researched: 2026-03-02*

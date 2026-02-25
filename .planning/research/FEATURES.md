# Feature Landscape

**Domain:** AI-powered code review assistant -- multi-LLM routing, wiki staleness detection, review pattern clustering, contributor profiles
**Researched:** 2026-02-25
**Milestone:** v0.20 Multi-Model & Active Intelligence
**Confidence:** HIGH for routing and profiles, MEDIUM for clustering and staleness

## Existing Foundation (Already Built)

These features are production and form the base for v0.20:

| Existing Capability | Module | How v0.20 Extends It |
|---------------------|--------|---------------------|
| Claude Agent SDK `query()` with MCP tools | `execution/executor.ts` | Non-agentic tasks routed to Vercel AI SDK `generateText()` while agentic tasks keep Agent SDK |
| `.kodiai.yml` config with model override | `execution/config.ts` | Extend with `models:` section mapping task types to provider/model pairs |
| Telemetry with provider, model, tokens, costUsd | `telemetry/types.ts` | Wire Vercel AI SDK usage callbacks into existing telemetry schema |
| Wiki pages ingested with section chunking | `knowledge/wiki-store.ts`, `wiki-sync.ts` | Cross-reference wiki content against code changes for staleness scoring |
| 18 months of review comments embedded | `knowledge/review-comment-store.ts` | Run HDBSCAN clustering on existing embeddings to discover review themes |
| Author classifier (first-time/regular/core) | `lib/author-classifier.ts` | Extend with per-topic expertise scores from contributor profile data |
| Slack thread sessions with user IDs | `slack/thread-session-store.ts` | Map Slack user IDs to GitHub usernames for cross-platform identity |
| Cross-corpus retrieval with RRF | `knowledge/retrieval.ts` | Inject cluster pattern context into retrieval pipeline |

## Table Stakes

Features users expect once these capabilities are advertised. Missing = feature feels half-baked.

| Feature | Why Expected | Complexity | Dependencies on Existing | Notes |
|---------|--------------|------------|--------------------------|-------|
| **Task-based model routing** | Users expect the right model for the right job -- cheap models for summaries, strong models for security review | Medium | Executor (`query()` call), `.kodiai.yml` config, telemetry store | Vercel AI SDK `generateText`/`streamText` with provider registry alongside existing Agent SDK for agentic tasks |
| **Provider configuration in .kodiai.yml** | Per-repo model preferences are the established config pattern | Low | Config loader (`loadRepoConfig`) | Extend existing schema with `models:` section mapping task types to model IDs |
| **Cost tracking per invocation** | Multi-model without cost visibility is irresponsible | Low | Telemetry store already tracks `provider`, `model`, `inputTokens`, `outputTokens`, `costUsd` | Existing `TelemetryRecord` schema already has the columns; wire Vercel AI SDK usage callbacks |
| **Wiki staleness scoring** | Without a score, "stale" is meaningless -- needs evidence-based ranking | Medium | Wiki store (`wiki_pages` table with `lastModified`, `revisionId`), code snippet store | Compare wiki page references against code corpus for deleted/changed symbols |
| **Staleness report delivery** | Detecting staleness without reporting it is useless | Low | Slack client, GitHub issue creation via Octokit | Scheduled job posts to Slack `#kodiai` or creates GitHub issue |
| **Cluster label generation** | Unlabeled clusters are noise, not insight | Medium | Review comment store (18 months of data), embedding provider | LLM-generated labels from cluster centroids or representative samples |
| **GitHub/Slack identity linking** | Cross-platform profiles are the whole point of contributor features | Low | Slack thread session store, GitHub webhook payloads | Manual mapping table with optional heuristic suggestions |
| **Contributor expertise inference** | Profile without expertise data is just a user record | Medium | Existing author-classifier (3-tier), review comment history, PR metadata | Extend author-classifier tiers with per-topic expertise scores |

## Differentiators

Features that set kodiai apart from generic code review bots. Not expected, but high-value.

| Feature | Value Proposition | Complexity | Dependencies on Existing | Notes |
|---------|-------------------|------------|--------------------------|-------|
| **Emergent review theme discovery** | No other bot surfaces "your last 50 PRs keep hitting the same 3 issues" from raw review data | High | Review comment store (embedded chunks), embedding provider (Voyage AI) | HDBSCAN on review comment embeddings; auto-discovers themes without predefined categories |
| **Recurring pattern injection into PR reviews** | "This PR triggers pattern X which appeared in 12 prior reviews" -- contextual, not just statistical | Medium | Review pipeline prompt builder, cross-corpus retrieval | Insert top-matching cluster themes into review prompt as additional context |
| **Wiki-to-code evidence linking** | Show exactly which code changes made a wiki page stale, with file paths and commit SHAs | High | Wiki store, code snippet store, git history access | Cross-reference wiki page content against code symbol changes; requires entity extraction |
| **Adaptive review depth per contributor** | First-time contributors get more explanation; core maintainers get terse, high-signal reviews | Low | Author-classifier already does 3-tier classification | Wire existing `AuthorTier` plus new expertise into review prompt template variations |
| **Multi-model cost optimization** | Route simple tasks to cheap models, complex tasks to frontier models -- visible cost savings | Medium | New model router, telemetry cost tracking | Show cost delta vs single-model baseline in telemetry reports |
| **Cross-platform activity timeline** | Unified view of a contributor's GitHub PRs + Slack questions for mentoring insight | Medium | Contributor profile table, telemetry store, Slack thread sessions | Query across surfaces for a single identity |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Real-time model switching mid-review** | Agent SDK `query()` is the agentic backbone with MCP tools; swapping models mid-execution breaks tool continuity | Route to different models per *task type* (review vs summary vs mention), not mid-task |
| **User-facing LLM provider selection UI** | No dashboard exists; GitHub comments are the interface | Config via `.kodiai.yml` model overrides per task type |
| **Automatic cross-platform identity resolution without confirmation** | False positives linking wrong GitHub/Slack accounts cause trust erosion | Manual linking with optional heuristic suggestions (same display name, email overlap) |
| **Custom clustering algorithm implementation** | HDBSCAN is well-studied; reimplementing wastes time and introduces bugs | Use `hdbscan-ts` npm package (TypeScript HDBSCAN implementation) |
| **Real-time clustering on every PR** | HDBSCAN on thousands of embeddings is expensive; unnecessary per-PR | Scheduled batch job (daily/weekly) with cached cluster assignments |
| **Wiki edit suggestions** | Kodiai is a reviewer, not a wiki editor; auto-editing wiki pages crosses trust boundaries | Surface staleness reports with evidence; humans decide what to update |
| **Bedrock/Vertex/arbitrary provider auth** | OAuth-only constraint for v1 (per PROJECT.md Out of Scope) | Support Vercel AI SDK providers that work with API keys: OpenAI, Anthropic, Google AI Studio |
| **Full contributor dashboard** | No UI surface exists; building one is a separate project | Expose contributor data through Slack queries and GitHub issue reports |
| **Hunk embedding for all past PRs as part of clustering** | Backfilling for clustering purposes is expensive and speculative | Cluster existing review comment embeddings which are already stored |

## Feature Dependencies

```
                    .kodiai.yml model config
                           |
                           v
Task-based model router -----> Cost tracking per invocation
        |                              |
        v                              v
Vercel AI SDK integration      Telemetry store extension
        |
        v
Non-agentic task routing (summaries, label generation)
        |
        v
Cluster label generation (uses cheap model)


Wiki page store (existing) -----> Wiki staleness scoring
Code snippet store (existing) -/       |
                                       v
                               Staleness report delivery
                                       |
                                       v
                               Wiki-to-code evidence linking


Review comment store (existing) -----> HDBSCAN clustering job
Embedding provider (existing) ------/       |
                                            v
                                    Cluster label generation
                                            |
                                            v
                                    Pattern injection into PR reviews


Author classifier (existing) -----> Contributor profile table
GitHub webhooks (existing) -------/       |
Slack sessions (existing) -------/        v
                                   GitHub/Slack identity linking
                                          |
                                          v
                                   Expertise inference
                                          |
                                          v
                                   Adaptive review depth
```

## MVP Recommendation

### Phase 1: Multi-LLM Routing (foundation for everything else)

Prioritize first because cluster labeling, staleness evidence generation, and contributor expertise inference all benefit from cheap model routing.

1. **Vercel AI SDK integration** -- wrap `generateText` with provider registry alongside existing Agent SDK `query()` for agentic tasks
2. **Task-type model configuration** -- extend `.kodiai.yml` with `models:` section mapping task types to provider/model pairs
3. **Cost tracking extension** -- existing telemetry schema already has `provider`, `model`, `costUsd` columns; wire Vercel AI SDK usage callbacks

### Phase 2: Review Pattern Clustering (highest differentiation value)

18 months of embedded review comments already exist. Clustering is pure computation on existing data.

1. **HDBSCAN batch clustering job** -- `hdbscan-ts` on review comment embeddings, store cluster assignments
2. **Cluster label generation** -- LLM-generated labels from representative samples per cluster (uses cheap model from Phase 1)
3. **Pattern injection into PR reviews** -- match incoming PR against known clusters, inject top matches into review prompt

### Phase 3: Wiki Staleness Detection (leverages existing wiki corpus)

Wiki pages already ingested with section chunking. Staleness detection is cross-referencing against code changes.

1. **Staleness scoring** -- compare wiki page content against recent code changes; score by reference decay
2. **Evidence linking** -- identify specific code changes that invalidate wiki content
3. **Report delivery** -- scheduled Slack message or GitHub issue with ranked stale pages and evidence

### Phase 4: Contributor Profiles (builds on all prior phases)

Identity linking is the foundation; expertise inference uses review history and pattern clusters from Phase 2.

1. **Contributor profile table** -- GitHub/Slack identity linking with manual confirmation
2. **Expertise inference** -- per-topic scores from review comment history and PR metadata
3. **Adaptive behavior** -- wire expertise into review prompt and retrieval weighting

**Defer:**
- **Cross-platform activity timeline**: Requires UI surface that does not exist; revisit when dashboard is in scope
- **Wiki-to-code deep symbol-level evidence linking**: Start with file-path-level staleness detection and iterate to symbol extraction later

## Detailed Feature Specifications

### Multi-LLM Task Routing

**How it works:** The Vercel AI SDK provides a unified `generateText()` / `streamText()` interface with pluggable providers. Each provider (Anthropic, OpenAI, Google) is registered once. A task router maps task types to model IDs. The existing Agent SDK `query()` remains for agentic tasks requiring MCP tools.

**Task types for kodiai:**
| Task Type | Current Approach | Recommended Model | Rationale |
|-----------|-----------------|-------------------|-----------|
| PR review (agentic) | Claude Agent SDK `query()` with MCP tools | Claude Sonnet 4 (keep Agent SDK) | Needs tool use, file editing, MCP servers |
| PR summary generation | Part of review prompt | GPT-4o-mini or Claude Haiku | Simple summarization, low cost |
| @mention response | Claude Agent SDK `query()` | Claude Sonnet 4 (keep Agent SDK) | Needs tool use for code navigation |
| Cluster label generation | N/A (new) | GPT-4o-mini or Claude Haiku | Template-based, low complexity |
| Staleness evidence synthesis | N/A (new) | Claude Haiku | Needs reasoning but no tools |
| Slack Q&A | Claude Agent SDK `query()` | Claude Sonnet 4 (keep Agent SDK) | Needs retrieval context reasoning |

**Key insight:** The Agent SDK `query()` remains the backbone for agentic tasks (review, mention, Slack write). Vercel AI SDK handles non-agentic tasks (summaries, label generation, staleness synthesis) where tool use is not needed. This is additive, not a replacement.

**Vercel AI SDK integration pattern:**
```typescript
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

// Provider registry
const providers = { anthropic, openai };

// Task router
const taskModels = {
  'summary': 'openai:gpt-4o-mini',
  'cluster-label': 'anthropic:claude-3-5-haiku-20241022',
  'staleness-evidence': 'anthropic:claude-3-5-haiku-20241022',
};

// Usage with built-in token tracking
const result = await generateText({
  model: resolveModel(taskModels[taskType]),
  prompt: taskPrompt,
});
// result.usage.promptTokens, result.usage.completionTokens available
```

**Confidence:** HIGH -- Vercel AI SDK is well-documented, actively maintained, and the provider model maps directly to kodiai's task types.

### Review Pattern Clustering (HDBSCAN)

**How it works:**
1. Extract embeddings from review comment chunks (already stored in `review_comments` table with Voyage AI embeddings)
2. Run HDBSCAN with `minClusterSize: 5` on the embedding vectors
3. HDBSCAN automatically determines cluster count and identifies noise points
4. For each cluster, sample 3-5 representative comments (closest to centroid)
5. Send representatives to cheap LLM to generate a human-readable theme label
6. Store cluster assignments and labels in a `review_clusters` table
7. On new PR review, compute embedding similarity of PR diff against cluster centroids
8. Inject top-2 matching patterns as additional context in review prompt

**Why HDBSCAN over K-means:**
- No need to specify cluster count upfront (emergent discovery)
- Handles noise (not every comment belongs to a theme)
- Works well with high-dimensional embedding spaces
- Varying density clusters (some themes appear 100x, others 10x)

**TypeScript implementation:** `hdbscan-ts` (npm) -- TypeScript HDBSCAN based on Campello et al. 2017. Accepts `number[][]`, returns `labels_` and `probabilities_`. Fits directly into the existing Bun/TypeScript stack. Install: `npm install hdbscan-ts`.

**Scale concern:** 18 months of review comments = thousands of chunks. HDBSCAN is O(n^2) in worst case. For ~10K-50K chunks, this runs in seconds on modern hardware. Schedule as a batch job (daily or weekly), not per-request.

**Storage schema:**
```sql
CREATE TABLE review_clusters (
  id SERIAL PRIMARY KEY,
  cluster_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  representative_ids INTEGER[] NOT NULL,
  centroid vector(1024),
  chunk_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  refreshed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE review_comment_cluster_assignments (
  chunk_id INTEGER REFERENCES review_comments(id),
  cluster_id INTEGER NOT NULL,
  probability REAL NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chunk_id)
);
```

**Confidence:** MEDIUM -- `hdbscan-ts` package exists but is not heavily battle-tested (low npm download count). May need to validate on actual review comment embeddings. Fallback: shell out to Python scikit-learn HDBSCAN if TypeScript package has quality issues.

### Wiki Staleness Detection

**How it works:**
1. For each wiki page, extract referenced code elements (file paths, function names, class names, API endpoints) using regex and heuristic extraction from wiki prose
2. Compare against recent code changes (git log, code snippet store) to find:
   - Deleted files/functions referenced by the wiki page
   - Renamed/moved files referenced by the wiki page
   - Significantly modified files (high churn) referenced by the wiki page
3. Score staleness: `staleness = (deleted_refs * 3 + modified_refs * 1) / total_refs`
4. Pages with staleness score above threshold get flagged
5. Generate evidence snippet using cheap LLM: "Page X references `PlayerCoreFactory::GetPlayers()` which was removed in commit abc123"
6. Deliver via scheduled report (Slack message to `#kodiai` or GitHub issue)

**Existing infrastructure leveraged:**
- `wiki_pages` table with `lastModified`, `revisionId`, section content, `stale` boolean column already exists
- `code_snippets` table with hunk-level embeddings and file paths
- Wiki sync scheduler already runs on a schedule (can piggyback staleness check)
- Slack client already posts to `#kodiai`

**Staleness signals (ranked by reliability):**
1. **Deleted symbol references** -- wiki mentions function/file that no longer exists (HIGH signal)
2. **Time-based decay** -- wiki page not updated in 6+ months while referenced code changed significantly (MEDIUM signal)
3. **Semantic drift** -- embedding similarity between wiki content and current code drops below threshold (LOW signal, experimental)

**Report format:**
```
Wiki Staleness Report (2026-02-25)
===================================
3 pages flagged as potentially stale:

1. HOW-TO:Compile_Kodi (staleness: 0.72)
   - References `tools/depends/target/zlib/Makefile` (deleted 2026-01-15)
   - Last wiki edit: 2025-08-03 (7 months ago)

2. Development/Code_style_conventions (staleness: 0.45)
   - References `docs/CODING_STYLE.md` (significantly modified, 23 commits since wiki edit)
   - Last wiki edit: 2025-11-20 (3 months ago)

3. JSON-RPC_API/v13 (staleness: 0.38)
   - References `xbmc/interfaces/json-rpc/` (4 files changed since wiki edit)
   - Last wiki edit: 2025-09-01 (6 months ago)
```

**Confidence:** MEDIUM -- File-path-level staleness detection is straightforward. Symbol-level extraction (function names from wiki prose) is harder and may need iteration. Start with file-path references and `lastModified` age. The `stale` boolean column already exists in wiki_pages schema, which is encouraging.

### Contributor Profiles & Cross-Platform Identity

**How it works:**
1. **Profile table:** `contributor_profiles` with `github_username`, `slack_user_id`, `display_name`, `expertise_topics`, `linked_at`
2. **Identity linking:** Manual command in Slack (`@kodiai link github:username`), or auto-suggest based on matching display names/emails
3. **Expertise inference:** Aggregate from:
   - Existing `AuthorTier` classification (first-time / regular / core)
   - File paths they frequently modify (from PR metadata in telemetry)
   - Review comment topics they engage with (from review comment store author field)
   - Languages they work in (from language classification on their PRs)
4. **Adaptive behavior:** Wire expertise into:
   - Review prompt: more/less explanation based on experience level
   - Retrieval weighting: boost results from their own prior reviews
   - Slack responses: adjust depth based on inferred expertise

**Existing infrastructure leveraged:**
- `author-classifier.ts` already classifies `first-time` / `regular` / `core` based on association + PR count
- Telemetry store tracks `prAuthor` per execution
- Slack thread session store has Slack user IDs
- Review comment store has author metadata from 18 months of backfill

**Cross-platform matching heuristics (for suggestions only, not auto-linking):**
1. Exact GitHub username match in Slack display name or status field
2. Email overlap (if available via GitHub API `GET /users/{username}`)
3. Same display name across platforms
4. Manual confirmation always required -- heuristics only suggest, never auto-link

**Storage schema:**
```sql
CREATE TABLE contributor_profiles (
  id SERIAL PRIMARY KEY,
  github_username TEXT UNIQUE,
  slack_user_id TEXT UNIQUE,
  display_name TEXT,
  expertise_topics JSONB DEFAULT '{}',
  author_tier TEXT DEFAULT 'regular',
  pr_count INTEGER DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  linked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Confidence:** HIGH for the profile table and manual linking. MEDIUM for expertise inference (needs tuning of topic extraction from review history). LOW for automatic identity resolution (heuristics are unreliable; manual linking is the safe default).

## Complexity Assessment

| Feature | Complexity | LOC Estimate | Test Estimate | Risk |
|---------|-----------|-------------|--------------|------|
| Multi-LLM routing + config | Medium | ~400 | ~200 | Low -- Vercel AI SDK well-documented |
| Cost tracking extension | Low | ~100 | ~50 | Low -- existing schema has columns |
| HDBSCAN clustering job | High | ~600 | ~300 | Medium -- `hdbscan-ts` needs validation |
| Cluster labels + injection | Medium | ~400 | ~200 | Medium -- prompt engineering for labels |
| Wiki staleness scoring | Medium | ~500 | ~250 | Medium -- entity extraction accuracy |
| Staleness reports | Low | ~200 | ~100 | Low -- existing Slack/GitHub clients |
| Contributor profile table | Low | ~300 | ~150 | Low -- standard CRUD |
| Identity linking | Low | ~200 | ~100 | Low -- manual flow |
| Expertise inference | Medium | ~400 | ~200 | Medium -- topic extraction tuning |
| Adaptive review behavior | Low | ~200 | ~100 | Low -- prompt variation |
| **Total** | | **~3,300** | **~1,650** | |

## Sources

- [Vercel AI SDK Documentation](https://vercel.com/docs/ai-sdk)
- [Vercel AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6)
- [Vercel AI Gateway for Multi-Model Integration (InfoQ)](https://www.infoq.com/news/2025/09/vercel-ai-gateway/)
- [hdbscan-ts npm package](https://www.npmjs.com/package/hdbscan-ts)
- [HDBSCAN scikit-learn documentation](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html)
- [hdbscan-js JavaScript implementation](https://github.com/shaileshpandit/hdbscan-js)
- [Detecting outdated code element references in documentation (Springer)](https://link.springer.com/article/10.1007/s10664-023-10397-6)
- [Google Code Wiki -- staleness detection approach (Medium)](https://medium.com/@yuwidhgamage/the-end-of-stale-documentation-deep-dive-into-googles-new-code-wiki-f67652aeb4de)
- [Content Freshness automation patterns (Cobbai)](https://cobbai.com/blog/knowledge-freshness-automation)
- [GitHub/Slack identity mapping patterns](https://github.com/hmcts/github-slack-user-mappings)
- [OpenRouter AI SDK Provider](https://github.com/OpenRouterTeam/ai-sdk-provider)
- Codebase: `src/execution/executor.ts`, `src/telemetry/types.ts`, `src/knowledge/wiki-types.ts`, `src/knowledge/wiki-sync.ts`, `src/knowledge/review-comment-store.ts`, `src/lib/author-classifier.ts`, `src/knowledge/retrieval.ts`

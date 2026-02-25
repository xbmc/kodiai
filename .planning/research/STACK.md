# Technology Stack

**Project:** Kodiai v0.20 Multi-Model & Active Intelligence
**Researched:** 2026-02-25

## Existing Stack (DO NOT change)

Already validated and shipping. Listed for integration reference only.

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| Bun | runtime | TypeScript runtime + package manager | Keep |
| Hono | ^4.11.8 | HTTP server | Keep |
| postgres (postgres.js) | ^3.4.8 | PostgreSQL client (tagged-template SQL) | Keep |
| pgvector extension | installed | Vector similarity search (HNSW indexes) | Keep |
| voyageai | ^0.1.0 | Embeddings (voyage-code-3, 1024 dims) | Keep |
| @anthropic-ai/claude-agent-sdk | ^0.2.37 | Claude Code CLI via `query()` for PR reviews, mentions, write-mode | Keep |
| @modelcontextprotocol/sdk | ^1.26.0 | MCP protocol | Keep |
| @octokit/rest | ^22.0.1 | GitHub API client | Keep |
| zod | ^4.3.6 | Schema validation | Keep |
| pino | ^10.3.0 | Structured logging | Keep |
| p-queue | ^9.1.0 | In-process job queue | Keep |
| picomatch | ^4.0.2 | Glob matching | Keep |

## New Stack Additions

### 1. Vercel AI SDK -- Multi-LLM Task Routing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| ai | ^6.0.x | Core SDK: `generateText()`, token usage tracking, provider abstraction | Unified API across providers with built-in token counting (inputTokens, outputTokens, totalUsage), cache-aware metrics (cacheReadTokens, cacheWriteTokens), and per-step usage tracking. Eliminates building provider-specific HTTP clients. |
| @ai-sdk/anthropic | ^3.0.x | Anthropic provider for Claude models via API key | First-class Claude support with extended thinking, prompt caching, structured outputs. Adds programmatic access alongside the existing Agent SDK for non-agentic tasks. |
| @ai-sdk/openai | ^3.0.x | OpenAI provider (GPT-4o-mini, o3-mini) | Enables cost-optimized routing: cheaper models for classification/summarization tasks where Claude's code toolchain is not needed. |
| @ai-sdk/google | ^3.0.x | Google provider (Gemini 2.0 Flash) | Low-cost high-speed option for simple structured tasks like staleness scoring, theme label generation. |

**Why Vercel AI SDK (not direct API clients):**

1. **Unified `generateText()` API** -- same call signature regardless of provider. Task router selects model string, consumer code is provider-agnostic.
2. **Built-in token tracking** -- `usage.inputTokens`, `usage.outputTokens`, `totalUsage` across multi-step calls. No manual counting needed. Maps directly to the `telemetry_events` table schema.
3. **Cache-aware metrics** -- `inputTokenDetails.cacheReadTokens` and `cacheWriteTokens` for Anthropic prompt caching cost optimization tracking.
4. **Bun compatible** -- Vercel explicitly supports Bun runtime. AI SDK uses standard `fetch()` under the hood; no Node.js-specific APIs. Confirmed by Bun blog and multiple community reports.
5. **No vendor lock-in** -- swap providers by changing one model string. Provider-specific features accessed via provider options, not API differences.

**Integration architecture -- two execution paths:**

```
KEEP (agentic tasks):
  Claude Agent SDK query() --> PR review, @mentions, write-mode
  Uses: MCP servers, file tools, workspace clone, abort controller
  Auth: Claude Max OAuth token

NEW (non-agentic tasks):
  Vercel AI SDK generateText() --> classification, summarization, labeling, scoring
  Uses: prompt in, structured text out, no tools needed
  Auth: Provider-specific API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
```

**Task-to-model routing table:**

| Task Type | Model | Provider | Rationale |
|-----------|-------|----------|-----------|
| PR review (agentic) | claude-sonnet-4-5 | Agent SDK (unchanged) | Needs file tools, MCP servers, workspace |
| @mention response (agentic) | claude-sonnet-4-5 | Agent SDK (unchanged) | Needs file tools, MCP servers, workspace |
| Wiki staleness scoring | gemini-2.0-flash | @ai-sdk/google | Fast, cheap, structured comparison output |
| Review pattern cluster labeling | claude-haiku-4-5 | @ai-sdk/anthropic | Good at summarization, low cost per call |
| Contributor expertise classification | gpt-4o-mini | @ai-sdk/openai | Fast classification, very low cost (~$0.15/M input tokens) |
| Staleness report generation | claude-sonnet-4-5 | @ai-sdk/anthropic | Quality writing for human-readable reports |
| Cluster theme summarization | claude-haiku-4-5 | @ai-sdk/anthropic | Batch labeling of review clusters |

**What NOT to use from Vercel AI SDK:**

- Do NOT use `@ai-sdk/vercel` (AI Gateway) -- requires Vercel deployment, adds network hop latency, charges token markup. Self-hosted on Azure, not needed.
- Do NOT replace Claude Agent SDK for PR reviews/mentions -- `query()` provides the full Claude Code toolchain (file editing, MCP servers, tool use). Vercel AI SDK is for non-agentic tasks only.
- Do NOT use `streamText()` -- Kodiai publishes to GitHub comments and Slack messages, not streaming UIs. `generateText()` returns complete results.
- Do NOT use `experimental_telemetry` / OpenTelemetry integration -- the `usage` object on the `generateText()` response contains everything needed. Log to existing `telemetry_events` table directly.
- Do NOT use `generateObject()` / `streamObject()` -- deprecated in AI SDK 6. Use `generateText()` with structured output settings instead.

**Confidence:** HIGH -- Verified via official AI SDK docs (ai-sdk.dev), npm registry (ai@6.0.97 published 2026-02-21, @ai-sdk/anthropic@3.0.46 published 2026-02-23), migration guide, and Anthropic provider docs.

### 2. HDBSCAN Clustering -- Review Pattern Discovery

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| hdbscan-ts | ^1.0.16 | Density-based clustering for emergent review pattern discovery | Pure TypeScript, works in Bun, no native dependencies, supports cluster membership probabilities. |

**Why hdbscan-ts:**

1. **TypeScript-native** -- written in TS, imports cleanly, no type stubs needed.
2. **No native deps** -- pure JS/TS implementation. No C++ bindings, no Python subprocess, no WASM. Critical for Bun compatibility and Docker image simplicity.
3. **Correct algorithm** -- HDBSCAN (not DBSCAN) automatically determines cluster count and handles noise points (labeled -1). Review patterns have variable density; DBSCAN would require manual epsilon tuning per repo.
4. **Simple API** -- `new HDBSCAN({ minClusterSize: N }).fit(data)` returns integer cluster labels.

**Usage example:**

```typescript
import { HDBSCAN } from "hdbscan-ts";

// Input: embedding vectors from review_comments table (1024-dim)
const embeddings: number[][] = reviewComments.map(c => c.embedding);
const hdbscan = new HDBSCAN({ minClusterSize: 5, minSamples: 3 });
const labels: number[] = hdbscan.fit(embeddings);
// labels[i] = cluster ID for comment i, or -1 for noise
```

**Integration flow:**

```
1. Query review_comments for repo (existing data, existing embeddings)
2. Extract embedding vectors (existing column in review_comments table)
3. Run HDBSCAN clustering on vectors --> cluster labels
4. For each cluster, sample 3-5 representative comments
5. Use Vercel AI SDK generateText() with claude-haiku-4-5 to auto-label the cluster theme
6. Store cluster_id + theme_label + member_count in new review_patterns DB table
7. During PR review, query review_patterns for repo and inject relevant themes into prompt
```

**Recommended starting parameters:**
- `minClusterSize: 5` -- at least 5 review comments to form a pattern (avoids singleton noise)
- `minSamples: 3` -- neighborhood density threshold (lower = more clusters, higher = stricter)

**Performance consideration:** HDBSCAN is O(n^2) in distance computation for the mutual reachability graph. For a repo with ~5,000 review comment embeddings (typical after 18 months of backfill), this is ~25M distance calculations on 1024-dim vectors. On Bun this may take 5-15 seconds. Run as a scheduled batch job (not inline during PR review). If performance is problematic, consider PCA dimensionality reduction to 64-128 dims before clustering.

**What NOT to use:**

- Do NOT use `density-clustering` npm -- last updated 10 years ago, only has DBSCAN/OPTICS (not HDBSCAN), no TypeScript.
- Do NOT use `hdbscanjs` -- less maintained, no TypeScript types, fewer features.
- Do NOT shell out to Python scikit-learn -- adds Python to Docker image, subprocess overhead, serialization complexity for float arrays.
- Do NOT use k-means -- requires specifying cluster count upfront. Review themes are emergent; count is unknown.

**Confidence:** MEDIUM -- hdbscan-ts is correct algorithmically and has a clean API, but has low npm download count (~30/week range for JS HDBSCAN packages). The algorithm is well-understood (scikit-learn reference). Mitigation: input is just float arrays, easy to validate output against Python reference. If hdbscan-ts proves unreliable, fallback is a minimal custom implementation (~200 lines for core MST-based HDBSCAN).

### 3. Wiki Staleness Detection -- No New Dependencies

No new packages needed. Built entirely from existing stack plus the Vercel AI SDK added above.

| Capability | Existing Technology | How Used |
|------------|-------------------|----------|
| Wiki page storage | `wiki_pages` table (postgres.js) | Query pages with `last_synced_at`, `content_hash` |
| Code change detection | Octokit `repos.listCommits()` | Identify commits touching paths referenced in wiki pages |
| Embedding drift detection | VoyageAI + pgvector | Compare wiki content embeddings against recent code snippet embeddings for semantic drift |
| Staleness scoring | Vercel AI SDK `generateText()` (NEW) | LLM judges whether code changes invalidate wiki content |
| Report generation | Vercel AI SDK `generateText()` (NEW) | Generate human-readable staleness report with evidence |
| Report delivery | Octokit `issues.create()` or Slack `chat.postMessage` | Publish to GitHub issue or Slack channel |
| Scheduling | Existing cron pattern (`wiki-sync.ts`) | Run staleness check on configurable schedule |

**Why no new packages:** Wiki staleness is a pipeline connecting existing capabilities. Wiki pages, their embeddings, and code change data all exist. The only new capability is LLM-based staleness judgment via the Vercel AI SDK (already added for multi-LLM routing).

**Confidence:** HIGH -- all underlying components verified in codebase.

### 4. Contributor Profiles -- No New Dependencies

No new packages needed. Uses existing stack with new database tables.

| Capability | Existing Technology | How Used |
|------------|-------------------|----------|
| Profile storage | New `contributor_profiles` table (postgres.js) | GitHub username, Slack user ID, expertise areas, review stats |
| Identity linking | Postgres lookup table | Match GitHub username to Slack user ID via config or heuristic matching |
| Expertise detection | Existing `author-classifier.ts` + telemetry data | Extend current tier system (first-time/regular/core) with language expertise and historical patterns |
| Adaptive behavior | Existing review prompt builder | Inject contributor expertise context into review and retrieval prompts |

**Why no new packages:** The existing `author-classifier.ts` already classifies contributors into tiers based on `authorAssociation` and PR count. Contributor profiles extend this with:
- Persistent storage (new Postgres table instead of ephemeral per-request classification)
- Cross-platform identity (GitHub username <-> Slack user ID lookup)
- Language expertise tracking (aggregated from review telemetry: which languages does this contributor review?)
- Historical pattern data (from the new review_patterns clustering)

The identity linking is a simple lookup table, not a complex identity resolution system. For v0.20, manual linking via config (or exact username match) is sufficient.

**Confidence:** HIGH -- extends existing patterns with new database tables only.

## Complete New Dependencies

```bash
# Core AI SDK (multi-LLM routing + cost tracking)
bun add ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google

# HDBSCAN clustering
bun add hdbscan-ts
```

**Total new packages: 5** (ai, @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google, hdbscan-ts)

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Multi-LLM | Vercel AI SDK | Direct API clients per provider | Fragmented token tracking, duplicated error handling, no unified interface, 3x more code |
| Multi-LLM | Vercel AI SDK | LangChain.js | Massive dependency tree (~50+ transitive deps), abstractions too heavyweight for simple generateText calls, poor Bun support |
| Multi-LLM | Vercel AI SDK | LiteLLM (Python proxy) | Adds Python runtime to Docker, network hop for every call, deployment complexity |
| Multi-LLM | Vercel AI SDK | @anthropic-ai/sdk direct | Only covers Anthropic; still need separate clients for OpenAI/Google. AI SDK unifies all three. |
| Clustering | hdbscan-ts | Python scikit-learn subprocess | Adds Python to Docker image, float array serialization via JSON, subprocess failure modes |
| Clustering | hdbscan-ts | density-clustering (npm) | 10 years unmaintained, no HDBSCAN (only DBSCAN), no TypeScript types |
| Clustering | hdbscan-ts | Custom k-means | Wrong algorithm -- requires specifying cluster count, poor with variable-density clusters |
| Clustering | hdbscan-ts | pgvector built-in clustering | pgvector has no clustering functions; it only does similarity search |
| Staleness | No new deps | Dedicated wiki-diff library | Over-engineered; embedding drift + git history comparison is sufficient |
| Profiles | No new deps | Auth0/identity service | Vastly over-engineered for single-workspace Slack + single GitHub org linking |

## Version Pinning Strategy

| Package | Pin Strategy | Rationale |
|---------|-------------|-----------|
| ai | ^6.0.x | Major version 6 is current (6.0.97 as of 2026-02-21); caret allows patch/minor |
| @ai-sdk/anthropic | ^3.0.x | Must match AI SDK 6 provider API (v3.x series); 3.0.46 current |
| @ai-sdk/openai | ^3.0.x | Must match AI SDK 6 provider API (v3.x series); 3.0.31 current |
| @ai-sdk/google | ^3.0.x | Must match AI SDK 6 provider API (v3.x series); 3.0.30 current |
| hdbscan-ts | ^1.0.x | Stable API surface; 1.0.16 current |

## Environment Variables (New)

| Variable | Required | Purpose |
|----------|----------|---------|
| ANTHROPIC_API_KEY | Yes | Anthropic API key for @ai-sdk/anthropic provider. Separate from Claude Agent SDK OAuth. |
| OPENAI_API_KEY | Yes | OpenAI API key for cost-optimized routing tasks (gpt-4o-mini) |
| GOOGLE_GENERATIVE_AI_API_KEY | Yes | Google AI API key for Gemini Flash tasks |

**Important:** The existing Claude Agent SDK uses Claude Max OAuth token authentication (configured via existing env vars). The new Vercel AI SDK Anthropic provider uses standard API key auth (`ANTHROPIC_API_KEY`). These are separate auth mechanisms for separate execution paths. Both can coexist.

## Database Migrations Needed

Next migration number: **010** (after existing 009-code-snippets.sql)

| Migration | Purpose | Tables/Columns |
|-----------|---------|----------------|
| 010-review-patterns.sql | Review pattern clusters from HDBSCAN | New table: `review_patterns` |
| 011-contributor-profiles.sql | Contributor profiles with cross-platform identity | New table: `contributor_profiles` |
| 012-model-usage.sql | Per-task model usage tracking for cost analysis | New table: `model_usage_events` |

### 010 Review Patterns

```sql
CREATE TABLE IF NOT EXISTS review_patterns (
  id BIGSERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  cluster_id INTEGER NOT NULL,
  theme_label TEXT NOT NULL,
  member_count INTEGER NOT NULL,
  representative_ids BIGINT[] NOT NULL,  -- FK refs to review_comments.id
  centroid vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo, cluster_id)
);
CREATE INDEX IF NOT EXISTS idx_review_patterns_repo ON review_patterns(repo);
```

### 011 Contributor Profiles

```sql
CREATE TABLE IF NOT EXISTS contributor_profiles (
  id BIGSERIAL PRIMARY KEY,
  github_username TEXT NOT NULL,
  slack_user_id TEXT,
  tier TEXT NOT NULL DEFAULT 'regular',  -- first-time, regular, core
  language_expertise JSONB DEFAULT '[]',  -- [{lang: "C++", pr_count: 42}, ...]
  total_prs INTEGER DEFAULT 0,
  total_reviews_received INTEGER DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(github_username)
);
CREATE INDEX IF NOT EXISTS idx_contributor_profiles_github ON contributor_profiles(github_username);
CREATE INDEX IF NOT EXISTS idx_contributor_profiles_slack ON contributor_profiles(slack_user_id) WHERE slack_user_id IS NOT NULL;
```

### 012 Model Usage Events

```sql
CREATE TABLE IF NOT EXISTS model_usage_events (
  id BIGSERIAL PRIMARY KEY,
  delivery_id TEXT,
  repo TEXT NOT NULL,
  task_type TEXT NOT NULL,  -- 'staleness_scoring', 'cluster_labeling', 'expertise_classification', etc.
  provider TEXT NOT NULL,   -- 'anthropic', 'openai', 'google'
  model TEXT NOT NULL,      -- 'claude-haiku-4-5', 'gpt-4o-mini', 'gemini-2.0-flash'
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  estimated_cost_usd NUMERIC(10, 6),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_model_usage_repo ON model_usage_events(repo);
CREATE INDEX IF NOT EXISTS idx_model_usage_task ON model_usage_events(task_type);
CREATE INDEX IF NOT EXISTS idx_model_usage_created ON model_usage_events(created_at);
```

## Docker Image Impact

- **Size increase:** Minimal (~2-5MB). All new packages are pure JavaScript/TypeScript with no native modules.
- **No new system dependencies:** No Python, no C++ compilation, no WASM.
- **Build time:** Negligible increase.
- **Base image:** Remains Debian-based (unchanged from v0.17 decision).

## What NOT to Add

| Rejected Dependency | Why Not |
|---------------------|---------|
| @ai-sdk/vercel (AI Gateway) | Requires Vercel hosting, adds latency, token markup. Self-hosted on Azure. |
| LangChain.js | 50+ transitive deps, heavy abstractions for what are simple generateText() calls |
| LiteLLM | Python proxy adds runtime, network hop, deployment complexity |
| OpenTelemetry / tracing SDK | Overkill. generateText().usage gives us everything needed for Postgres logging |
| Redis / Valkey | Not needed. PostgreSQL + in-memory cache handles all v0.20 caching needs |
| Identity resolution library | Single GitHub org + single Slack workspace. Lookup table is sufficient. |
| cron / node-schedule | Existing scheduled job pattern in wiki-sync.ts works. No cron library needed. |
| Dimensionality reduction (UMAP/PCA) | Only add if HDBSCAN proves slow on full 1024-dim vectors. Premature optimization. |

## Sources

- [AI SDK Documentation](https://ai-sdk.dev/docs/introduction) -- HIGH confidence
- [AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6) -- HIGH confidence
- [AI SDK Anthropic Provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic) -- HIGH confidence
- [AI SDK 6 Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) -- HIGH confidence
- [generateText Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) -- HIGH confidence
- [ai npm package v6.0.97](https://www.npmjs.com/package/ai) -- HIGH confidence
- [@ai-sdk/anthropic npm v3.0.46](https://www.npmjs.com/package/@ai-sdk/anthropic) -- HIGH confidence
- [hdbscan-ts npm v1.0.16](https://www.npmjs.com/package/hdbscan-ts) -- MEDIUM confidence (low download count)
- [Bun Runtime Support on Vercel](https://bun.com/blog/vercel-adds-native-bun-support) -- HIGH confidence
- [Vercel AI Gateway Overview](https://www.infoq.com/news/2025/09/vercel-ai-gateway/) -- for understanding what NOT to use

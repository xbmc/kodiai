# Architecture Patterns

**Domain:** Multi-LLM routing, wiki staleness detection, review pattern clustering, contributor profiles for existing GitHub App
**Researched:** 2026-02-25

## Recommended Architecture

Four new subsystems integrate into the existing Kodiai architecture. Each is designed as an additive module following the established factory-function pattern, with clear integration points into the current event router, retrieval pipeline, and telemetry stack.

### High-Level Component Map

```
                         +---------------------------+
                         |     Webhook / Slack       |
                         |     Event Ingress         |
                         +------------+--------------+
                                      |
                         +------------v--------------+
                         |      Event Router         |
                         |  (existing, unchanged)    |
                         +------------+--------------+
                                      |
               +-----------+----------+-----------+
               |           |                      |
    +----------v-------+ +-v--------------+  +----v-----------------+
    |  Review Handler  | | Mention Handler|  |  Scheduled Jobs      |
    |  (modified)      | | (modified)     |  |  (new + modified)    |
    +----------+-------+ +-------+--------+  +----+-----------------+
               |                 |                 |
    +----------v-----------------v-----------------v-------------------+
    |                                                                  |
    |  +-------------+  +--------------+  +--------------------------+ |
    |  | Model Router|  | Contributor  |  | NEW: src/intelligence/   | |
    |  | (NEW)       |  | Profiles     |  |  - pattern-cluster.ts    | |
    |  | src/llm/    |  | (NEW)        |  |  - wiki-staleness.ts     | |
    |  |             |  | src/identity/ |  |                          | |
    |  +------+------+  +------+-------+  +------------+-------------+ |
    |         |                |                        |               |
    |  +------v----------------v------------------------v-------------+ |
    |  |              PostgreSQL (existing pool)                      | |
    |  |  + model_cost_events  + contributor_profiles                 | |
    |  |  + review_patterns    + identity_links                      | |
    |  |  + wiki_staleness_snapshots                                 | |
    |  +-------------------------------------------------------------+ |
    |                                                                  |
    +------------------------------------------------------------------+
```

### New Modules

| Module | Location | Responsibility | Integrates With |
|--------|----------|----------------|-----------------|
| Model Router | `src/llm/` | Task-based LLM selection via Vercel AI SDK provider registry | Executor, telemetry, config |
| Contributor Profiles | `src/identity/` | Cross-platform identity linking (GitHub + Slack) and expertise tracking | Review handler, mention handler, Slack assistant, retrieval |
| Pattern Clustering | `src/intelligence/pattern-cluster.ts` | HDBSCAN clustering of review findings into emergent themes | Review handler (output enrichment), scheduled job (batch clustering) |
| Wiki Staleness | `src/intelligence/wiki-staleness.ts` | Detect wiki pages invalidated by code changes | Wiki sync scheduler, scheduled job, GitHub issue/Slack report |

### Existing Modules Modified

| Module | Change | Reason |
|--------|--------|--------|
| `src/execution/executor.ts` | No change -- Agent SDK `query()` stays for agentic PR review | Model router handles only new non-agentic tasks |
| `src/execution/config.ts` | Add `models` section to `.kodiai.yml` schema | Per-repo model preferences |
| `src/handlers/review.ts` | Inject contributor profile for tone adaptation; inject pattern clusters into prompt context | Adaptive behavior + pattern surfacing |
| `src/handlers/mention.ts` | Inject contributor profile for expertise-aware responses | Adaptive behavior |
| `src/knowledge/wiki-sync.ts` | After sync, trigger staleness detection pass | Staleness detection pipeline |
| `src/telemetry/store.ts` | Add `recordModelCost()` method for per-task cost tracking | Multi-model cost observability |
| `src/index.ts` | Wire new stores, scheduler hooks, identity resolution | Bootstrap new subsystems |
| `src/config.ts` | Add optional env vars for additional LLM provider keys | Multi-provider auth |

## Component Details

### 1. Model Router (`src/llm/`)

**Purpose:** Provide task-based model selection so different operations use appropriately-sized models.

**Key insight:** The current executor calls Claude Agent SDK `query()` for everything. The Agent SDK must remain for the agentic PR review loop (it provides the full toolchain: file reading, MCP tool servers, workspace interaction, multi-turn tool use). But non-agentic tasks -- staleness analysis, pattern labeling, contributor summary generation, Slack Q&A -- can use Vercel AI SDK `generateText()` with cheaper/faster models.

**Files:**

```
src/llm/
  index.ts              # Re-exports
  registry.ts           # createModelRegistry() -- Vercel AI SDK provider registry
  router.ts             # createModelRouter() -- task-type -> model mapping
  types.ts              # TaskType, ModelSelection, CostRecord types
  cost-tracker.ts       # Per-invocation cost logging to PostgreSQL
```

**Architecture:**

```typescript
// registry.ts -- wraps Vercel AI SDK createProviderRegistry()
import { createProviderRegistry, customProvider } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export function createModelRegistry(config: ModelRegistryConfig) {
  return createProviderRegistry({
    anthropic: customProvider({
      languageModels: {
        "review": anthropic("claude-sonnet-4-5"),
        "analysis": anthropic("claude-haiku-4-5"),
        "fast": anthropic("claude-haiku-4-5"),
      },
      fallbackProvider: anthropic,
    }),
    // Additional providers can be registered with API keys from env vars
  });
}

// router.ts -- maps task types to model IDs
type TaskType =
  | "pr_review"           // Agentic loop (stays on Agent SDK, NOT routed here)
  | "staleness_analysis"  // Wiki staleness reasoning
  | "pattern_labeling"    // Cluster theme naming
  | "contributor_summary" // Profile generation
  | "slack_qa"            // Slack assistant
  | "mention_response";   // @mention reply

export function createModelRouter(registry, config) {
  const taskModelMap: Record<TaskType, string> = {
    pr_review: "anthropic:review",            // NOT used via generateText
    staleness_analysis: "anthropic:analysis",
    pattern_labeling: "anthropic:fast",
    contributor_summary: "anthropic:fast",
    slack_qa: "anthropic:analysis",
    mention_response: "anthropic:analysis",
  };

  return {
    async generate(task: TaskType, prompt: string, options?) {
      const modelId = config.overrides?.[task] ?? taskModelMap[task];
      const model = registry.languageModel(modelId);
      const result = await generateText({ model, prompt, ...options });
      // fire-and-forget cost tracking
      void costTracker.record({ task, modelId, ...result.usage });
      return result;
    },
  };
}
```

**Integration points:**
- PR review stays on Agent SDK `query()`. The model router is used for new non-agentic tasks only.
- `src/intelligence/*.ts`: Staleness analysis and pattern labeling call `modelRouter.generate()`.
- `src/slack/assistant-handler.ts`: Can optionally route through model router instead of hardcoded `slackAssistantModel`.
- `.kodiai.yml`: New `models` section allows per-repo task->model overrides.
- `src/config.ts`: New optional env vars `ANTHROPIC_API_KEY` (separate from Claude Max OAuth used by Agent SDK).

**Critical constraint:** The Agent SDK `query()` uses Claude Max OAuth. Vercel AI SDK providers use API keys. These are separate auth paths. PR review continues through Agent SDK; only new non-agentic tasks use Vercel AI SDK.

### 2. Contributor Profiles (`src/identity/`)

**Purpose:** Link GitHub and Slack identities, track expertise areas, and adapt review/response behavior per contributor.

**Files:**

```
src/identity/
  index.ts                  # Re-exports
  store.ts                  # createContributorStore() -- PostgreSQL CRUD
  types.ts                  # ContributorProfile, IdentityLink types
  linker.ts                 # Identity resolution: GitHub login <-> Slack user ID
  expertise.ts              # Compute expertise from review history + PR activity
```

**Schema (new migration 010-contributor-profiles.sql):**

```sql
CREATE TABLE contributor_profiles (
  id              SERIAL PRIMARY KEY,
  github_login    TEXT UNIQUE,
  slack_user_id   TEXT UNIQUE,
  display_name    TEXT,
  expertise_areas JSONB DEFAULT '[]',
  review_stats    JSONB DEFAULT '{}',
  first_seen_at   TIMESTAMPTZ DEFAULT now(),
  last_active_at  TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_contributor_github ON contributor_profiles(github_login);
CREATE INDEX idx_contributor_slack ON contributor_profiles(slack_user_id);
```

**Identity linking approach:**

Explicit linking via Slack command (`!kodiai link @github-user`) or automatic matching when GitHub profile email matches Slack profile email. No external SCIM or OAuth dance needed for a single-workspace setup.

```typescript
// linker.ts
export function createIdentityLinker(deps: { store: ContributorStore; logger: Logger }) {
  return {
    // Called by review handler on every PR event -- upsert GitHub identity
    async touchGitHub(login: string, metadata?: { prLanguages?: string[] }),

    // Called by Slack handler -- upsert Slack identity
    async touchSlack(slackUserId: string, displayName?: string),

    // Explicit link command from Slack
    async linkIdentities(githubLogin: string, slackUserId: string),

    // Resolve: given a GitHub login, find the full profile
    async resolveFromGitHub(login: string): Promise<ContributorProfile | null>,

    // Resolve: given a Slack user ID, find the full profile
    async resolveFromSlack(slackUserId: string): Promise<ContributorProfile | null>,
  };
}
```

**Expertise computation:**

Derive expertise from existing data rather than requiring manual input:
- PR file paths -> language/area classification (reuse `classifyFileLanguage()` from `src/execution/diff-analysis.ts`)
- Review comment frequency by file area
- Approval patterns on specific subsystems

Run as a periodic batch job (daily), not on every request.

**Integration points:**
- `src/handlers/review.ts`: After loading PR metadata, resolve contributor profile. Pass expertise to prompt builder for tone calibration (existing author-experience detection in v0.8 can use real data instead of heuristics).
- `src/handlers/mention.ts`: Resolve profile to tailor response depth.
- `src/slack/assistant-handler.ts`: Resolve Slack user to GitHub identity for context-aware answers.
- `src/knowledge/retrieval.ts`: Contributor expertise can influence source weighting (boost wiki for newcomers, boost code for experts).

### 3. Review Pattern Clustering (`src/intelligence/pattern-cluster.ts`)

**Purpose:** Discover emergent themes in review findings (e.g., "memory management issues," "missing error handling") and surface them as context in PR reviews.

**Files:**

```
src/intelligence/
  index.ts                  # Re-exports
  pattern-cluster.ts        # HDBSCAN clustering + theme extraction
  pattern-store.ts          # PostgreSQL persistence for clusters
  pattern-types.ts          # Cluster, Theme, PatternMatch types
```

**HDBSCAN implementation choice:** Use `hdbscanjs` (npm) -- pure JavaScript implementation with no native dependencies, compatible with Bun. The dataset size (thousands of review findings, not millions) does not require optimized native code. Each finding is already embedded as a 1024-dim vector via Voyage AI, so the distance matrix computation is straightforward.

**Schema (new migration 011-review-patterns.sql):**

```sql
CREATE TABLE review_pattern_clusters (
  id              SERIAL PRIMARY KEY,
  repo            TEXT NOT NULL,
  cluster_label   TEXT NOT NULL,
  description     TEXT,
  finding_count   INT NOT NULL DEFAULT 0,
  centroid        vector(1024),
  sample_findings JSONB DEFAULT '[]',
  first_seen_at   TIMESTAMPTZ NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pattern_clusters_repo ON review_pattern_clusters(repo);
CREATE INDEX idx_pattern_clusters_hnsw ON review_pattern_clusters
  USING hnsw (centroid vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

**Processing pipeline:**

```
1. Scheduled job (weekly): Fetch all review findings with embeddings for a repo
2. Run HDBSCAN on embedding vectors (min_cluster_size=5, min_samples=3)
3. For each cluster:
   a. Compute centroid (mean of member embeddings)
   b. Select top-3 representative findings (closest to centroid)
   c. Call model router (task: "pattern_labeling") to generate theme label + description
4. Upsert clusters to review_pattern_clusters table
5. During PR review: query clusters by embedding similarity to current findings
6. Inject matching patterns into review prompt as "Recurring themes in this codebase"
```

**Integration points:**
- `src/handlers/review.ts`: After retrieval, query pattern clusters for context enrichment. Include in prompt as "Known recurring patterns" section.
- `src/knowledge/store.ts`: Findings already stored with embeddings -- query them for clustering input.
- `src/llm/router.ts`: Pattern labeling uses `pattern_labeling` task type (cheap/fast model).
- Scheduled job in `src/index.ts`: Register weekly interval, integrate with shutdown manager.

### 4. Wiki Staleness Detection (`src/intelligence/wiki-staleness.ts`)

**Purpose:** Identify wiki pages that reference code patterns, APIs, or behaviors that have changed since the page was last updated.

**Files:**

```
src/intelligence/
  wiki-staleness.ts         # Staleness detection logic
  wiki-staleness-types.ts   # StalePageReport, StalenessSignal types
  wiki-staleness-report.ts  # Format reports for GitHub issue / Slack message
```

**Detection approach:**

The wiki pages are already chunked and embedded. Code changes from PRs are tracked. The staleness detection cross-references these:

```
1. For each merged PR (or batch of recent merges):
   a. Extract changed file paths and function/class names from diff
   b. Query wiki page embeddings for semantic similarity to changed code
   c. For matches above threshold: compare wiki page last_synced_at vs merge date
   d. If wiki references code that changed AFTER wiki was last updated -> STALE signal

2. Evidence collection:
   a. Which code changed (file, function, PR number)
   b. Which wiki section references it (page title, section heading, snippet)
   c. How confident is the staleness signal (embedding similarity score)

3. Report generation:
   a. Group stale signals by wiki page
   b. Call model router (task: "staleness_analysis") to summarize evidence
   c. Publish as GitHub issue or Slack message
```

**Schema (new migration 012-wiki-staleness.sql):**

```sql
CREATE TABLE wiki_staleness_signals (
  id               SERIAL PRIMARY KEY,
  repo             TEXT NOT NULL,
  wiki_page_title  TEXT NOT NULL,
  wiki_section     TEXT,
  pr_number        INT NOT NULL,
  changed_file     TEXT NOT NULL,
  similarity_score FLOAT NOT NULL,
  evidence_snippet TEXT,
  status           TEXT DEFAULT 'pending',
  detected_at      TIMESTAMPTZ DEFAULT now(),
  reported_at      TIMESTAMPTZ
);

CREATE INDEX idx_staleness_repo_status ON wiki_staleness_signals(repo, status);
```

**Integration points:**
- `src/knowledge/wiki-sync.ts`: After wiki sync completes, trigger staleness check against recent PRs.
- `src/handlers/review.ts`: On PR merge event, fire-and-forget staleness check for the merged changes.
- Scheduled job: Weekly batch scan comparing all wiki pages against recent code changes.
- Report output: Create GitHub issue in wiki source repo or post to `#kodiai` Slack channel.

## Data Flow Changes

### Current Flow (unchanged for PR review)

```
Webhook -> Event Router -> Review Handler -> Retrieval -> Prompt Builder
  -> Agent SDK query() -> MCP tools -> GitHub
```

### New Flow: Non-Agentic Tasks via Model Router

```
Scheduled Job / Post-Review Hook
  -> Model Router (Vercel AI SDK generateText())
  -> PostgreSQL (store results)
  -> GitHub Issue / Slack (publish reports)
```

### New Flow: Identity-Enriched Review

```
Webhook -> Review Handler
  -> Contributor Profile lookup (identity store, cached)
  -> Retrieval (existing, + pattern cluster query)
  -> Prompt Builder (enriched with profile + patterns)
  -> Agent SDK query() (unchanged)
  -> Telemetry (enhanced with model cost tracking)
```

## Patterns to Follow

### Pattern 1: Factory Function with Dependency Injection

**What:** Every new module exports a `createXxx(deps)` factory function that receives its dependencies explicitly.

**When:** All new stores, routers, and services.

**Why:** This is the established pattern across the entire codebase (`createKnowledgeStore`, `createTelemetryStore`, `createReviewCommentStore`, `createRetriever`, `createExecutor`, `createJobQueue`).

**Example:**
```typescript
export function createContributorStore(deps: {
  sql: Sql;
  logger: Logger;
}): ContributorStore {
  const { sql, logger } = deps;
  return {
    async upsertFromGitHub(login: string): Promise<ContributorProfile> {
      const [row] = await sql`
        INSERT INTO contributor_profiles (github_login, last_active_at)
        VALUES (${login}, now())
        ON CONFLICT (github_login)
        DO UPDATE SET last_active_at = now(), updated_at = now()
        RETURNING *
      `;
      return mapRow(row);
    },
  };
}
```

### Pattern 2: Fire-and-Forget for Non-Critical Work

**What:** Async operations that should not block the critical path use `void promise.catch()`.

**When:** Cost tracking, staleness detection after PR merge, pattern cluster updates.

**Why:** Established pattern throughout codebase -- hunk embedding, telemetry recording, and smoke tests all use this.

**Example:**
```typescript
// In review handler, after review completes:
void detectWikiStaleness({
  repo: `${owner}/${repo}`,
  changedFiles: diffFiles,
  wikiPageStore,
  modelRouter,
  stalenessStore,
  logger,
}).catch((err) => logger.warn({ err }, "Wiki staleness detection failed (non-fatal)"));
```

### Pattern 3: Scheduled Job via setInterval with Shutdown Integration

**What:** Periodic jobs registered as intervals, stopped via shutdown manager.

**When:** Pattern clustering (weekly), wiki staleness batch scan, expertise recomputation (daily).

**Why:** The wiki sync scheduler already uses this exact pattern. No external cron dependency needed for a single-instance app.

**Example:**
```typescript
const patternClusterInterval = setInterval(async () => {
  try {
    await runPatternClustering({ /* deps */ });
  } catch (err) {
    logger.warn({ err }, "Pattern clustering failed (non-fatal)");
  }
}, 7 * 24 * 60 * 60 * 1000); // weekly

// Register with shutdown manager
shutdownManager.onShutdown(() => clearInterval(patternClusterInterval));
```

### Pattern 4: Lazy Resolution with InMemoryCache

**What:** Profile lookups use the existing `createInMemoryCache` with short TTL.

**When:** Contributor profile resolution in handlers.

**Why:** Avoids database hit on every webhook event. The `createInMemoryCache` pattern with lazy eviction is already used for Slack installation context.

**Example:**
```typescript
const profileCache = createInMemoryCache<string, ContributorProfile>({
  maxSize: 500,
  ttlMs: 15 * 60 * 1000, // 15 min
});
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Replacing Agent SDK with Vercel AI SDK for PR Review

**What:** Attempting to use Vercel AI SDK `generateText()` for the agentic PR review loop.

**Why bad:** The Claude Agent SDK provides the full Claude Code toolchain (file reading, MCP tool servers, workspace interaction, multi-turn tool use). Vercel AI SDK provides text generation but not this agentic infrastructure. PR review fundamentally requires the agent loop.

**Instead:** Use Vercel AI SDK only for non-agentic tasks (classification, summarization, labeling). Keep Agent SDK for PR review and mention handling.

### Anti-Pattern 2: Synchronous Identity Resolution on Every Request

**What:** Querying contributor_profiles table on every webhook event before processing.

**Why bad:** Adds latency to the critical path. Most events do not need profile data.

**Instead:** Lazy resolution -- only query when the handler actually needs profile data (review prompt building, not webhook receipt). Cache with short TTL.

### Anti-Pattern 3: Real-Time Clustering on Every Review

**What:** Running HDBSCAN after every PR review to update clusters.

**Why bad:** HDBSCAN on thousands of embeddings is O(n^2) for distance computation. Even with the JS implementation, this adds seconds of compute.

**Instead:** Batch clustering on a schedule (weekly). During PR review, only query existing clusters by embedding similarity (fast HNSW lookup on centroid column).

### Anti-Pattern 4: Storing Provider API Keys in .kodiai.yml

**What:** Allowing repos to specify their own LLM API keys in the config file.

**Why bad:** Config files are committed to git. API keys in git repos are a security incident.

**Instead:** All provider API keys are server-side env vars only. `.kodiai.yml` can specify task->model name preferences, not credentials.

### Anti-Pattern 5: Coupling Vercel AI SDK Token Tracking to Existing Telemetry

**What:** Trying to use the existing `TelemetryRecord` type for Vercel AI SDK calls.

**Why bad:** The existing telemetry is tightly structured around Agent SDK result messages (session_id, num_turns, stop_reason, cache tokens). Vercel AI SDK returns different usage metadata.

**Instead:** Create a separate `model_cost_events` table with its own schema optimized for per-task cost tracking. Keep existing telemetry_events for Agent SDK executions.

## Database Migration Plan

Four new migrations, following the existing sequential numbering (current latest is 009):

| Migration | Tables | Purpose |
|-----------|--------|---------|
| `010-contributor-profiles.sql` | `contributor_profiles` | Identity linking and expertise tracking |
| `011-review-patterns.sql` | `review_pattern_clusters` | Clustered review theme persistence |
| `012-wiki-staleness.sql` | `wiki_staleness_signals` | Staleness detection signal storage |
| `013-model-cost-events.sql` | `model_cost_events` | Per-task LLM cost tracking |

The `model_cost_events` table extends telemetry:

```sql
CREATE TABLE model_cost_events (
  id              SERIAL PRIMARY KEY,
  task_type       TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INT DEFAULT 0,
  output_tokens   INT DEFAULT 0,
  estimated_cost  FLOAT DEFAULT 0,
  repo            TEXT,
  delivery_id     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_model_cost_task ON model_cost_events(task_type);
CREATE INDEX idx_model_cost_created ON model_cost_events(created_at);
```

## Scalability Considerations

| Concern | Current Scale | v0.20 Impact | Mitigation |
|---------|--------------|--------------|------------|
| LLM API calls | ~50/day (reviews + mentions) | +20-30/day (staleness, patterns, labels) | Cheaper models (Haiku) for new tasks; batch where possible |
| Database size | ~100K rows across tables | +50K/year (staleness signals, cost events, clusters) | Retention purge (existing pattern); staleness signals auto-resolve |
| Embedding computation | ~200/day (chunks) | No increase (reuse existing embeddings for clustering) | N/A |
| Scheduled jobs | 1 (wiki sync every 6h) | +2 (pattern clustering weekly, expertise daily) | Stagger schedules; all fire-and-forget |
| Memory (HDBSCAN) | N/A | O(n^2) distance matrix for clustering | Cap at 5000 findings per clustering run; shard by repo |

## Build Order Rationale

```
Phase 1: Model Router + Cost Tracking
  Deps: none
  New: src/llm/, migration 013
  Modified: src/config.ts (env vars)
  Rationale: Foundation for all other features -- staleness and pattern
    labeling need generateText(). Self-contained with no changes to
    existing review flow.

Phase 2: Contributor Profiles + Identity Linking
  Deps: none (independent of Phase 1)
  New: src/identity/, migration 010
  Modified: src/handlers/review.ts, src/handlers/mention.ts, src/index.ts
  Rationale: Prerequisite for adaptive behavior. Light handler integration.

Phase 3: Wiki Staleness Detection
  Deps: Phase 1 (model router for staleness analysis LLM calls)
  New: src/intelligence/wiki-staleness*.ts, migration 012
  Modified: src/knowledge/wiki-sync.ts, src/index.ts
  Rationale: Uses existing wiki store and code change data. Model router
    provides the LLM summarization capability.

Phase 4: Review Pattern Clustering
  Deps: Phase 1 (model router for theme labeling)
  New: src/intelligence/pattern-cluster*.ts, migration 011
  Modified: src/handlers/review.ts (prompt injection), src/index.ts
  Rationale: Most complex feature. HDBSCAN integration, cluster management,
    prompt enrichment. Depends on model router for theme generation.
```

**Dependency chain:** Model Router is the foundation -- it provides `generateText()` to both staleness analysis and pattern labeling. Contributor Profiles are independent and can be built in parallel with Phase 1. Wiki Staleness and Pattern Clustering both require Model Router to be available.

**Phases 1 and 2 can run in parallel.** Phases 3 and 4 depend on Phase 1 completion.

## Sources

- [Vercel AI SDK Provider Management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management) -- HIGH confidence, official docs
- [Vercel AI SDK generateText](https://ai-sdk.dev/docs/ai-sdk-core/generating-text) -- HIGH confidence, official docs
- [AI SDK 6 announcement](https://vercel.com/blog/ai-sdk-6) -- HIGH confidence, official blog
- [hdbscanjs npm package](https://www.npmjs.com/package/hdbscanjs) -- MEDIUM confidence, community package
- [GitHub Slack user mappings pattern](https://github.com/hmcts/github-slack-user-mappings) -- MEDIUM confidence, community pattern
- Codebase analysis: `src/execution/executor.ts`, `src/knowledge/retrieval.ts`, `src/index.ts`, `src/telemetry/`, `src/config.ts`, `src/execution/config.ts`, `src/db/migrations/` -- HIGH confidence, primary source

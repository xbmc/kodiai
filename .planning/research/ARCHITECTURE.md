# Architecture: Issue Intelligence Integration

**Domain:** GitHub App -- issue intelligence features for existing webhook/handler/retrieval architecture
**Researched:** 2026-02-26

## Executive Summary

The v0.22 features (historical issue ingestion, duplicate detection, PR-issue linking, auto-triage on `issues.opened`) integrate cleanly into the existing architecture because v0.21 already laid the foundation: the `issues` and `issue_comments` tables exist with HNSW indexes and tsvector columns, `IssueStore` provides full CRUD + vector/text search including `findSimilar()`, and the triage agent already runs in the mention handler. The work is primarily: (1) a new backfill module and nightly sync scheduler, (2) a new duplicate detector module consumed by the auto-triage handler, (3) a new PR-issue linker triggered on PR events, and (4) a new `issues.opened` webhook handler that wires triage + duplicate detection together.

No new architectural patterns are needed. Every new component follows an existing pattern in the codebase.

## Recommended Architecture

### High-Level Integration Map

```
                          GitHub Webhooks
                               |
                         Event Router
                        /      |       \
              issues.opened  PR events  issue_comment.created (existing)
                   |            |              |
            [NEW] Auto-      [NEW] PR-    [EXISTING] Mention
            Triage Handler   Issue Linker  Handler (triage path)
                   |            |
            Duplicate       Reference
            Detector        Search
                   |            |
              IssueStore    IssueStore
              (existing)    (existing)
                   |
          MCP Tools: issue_label, issue_comment (existing)

        Scheduled Jobs:
        +----------------------------------------------+
        | [NEW] Issue Backfill (one-shot script)       |
        | [NEW] Issue Sync Scheduler (nightly)         |
        | [EXISTING] Wiki Sync (nightly)               |
        | [EXISTING] Cluster Refresh (weekly)          |
        | [EXISTING] Staleness Detection (weekly)      |
        +----------------------------------------------+
```

### New Components

| Component | Location | Responsibility | Depends On |
|-----------|----------|---------------|------------|
| Issue Backfill Module | `src/knowledge/issue-backfill.ts` | Paginated historical ingestion of issues + comments with embedding | IssueStore, EmbeddingProvider, Octokit |
| Issue Backfill Script | `scripts/backfill-issues.ts` | CLI wrapper that runs the backfill | issue-backfill module |
| Issue Sync Scheduler | `src/knowledge/issue-sync.ts` | Nightly incremental sync of updated/new issues | IssueStore, EmbeddingProvider, GitHubApp |
| Duplicate Detector | `src/knowledge/issue-duplicate-detector.ts` | High-confidence duplicate detection via vector similarity | IssueStore, EmbeddingProvider |
| PR-Issue Linker | `src/handlers/pr-issue-linker.ts` | Links PRs to issues via reference parsing + semantic search | IssueStore, EmbeddingProvider, Octokit |
| Auto-Triage Handler | `src/handlers/issue-opened.ts` | Orchestrates triage + duplicate detection on `issues.opened` | Duplicate Detector, Triage Agent, IssueStore, MCP Tools |
| Issue Retrieval Helper | `src/knowledge/issue-retrieval.ts` | Hybrid search adapter for cross-corpus RRF | IssueStore |

### Modified Components

| Component | Location | Change |
|-----------|----------|--------|
| Event Router registrations | `src/index.ts` | Register `issues.opened` handler and PR-issue linker |
| Retrieval pipeline | `src/knowledge/retrieval.ts` | Add `issue` source type to cross-corpus RRF fan-out |
| Cross-corpus RRF | `src/knowledge/cross-corpus-rrf.ts` | Add `"issue"` to `SourceType` union |
| Triage config schema | `src/execution/config.ts` | Add `autoTriageOnOpen` boolean and `duplicateDetection` sub-schema |
| Shutdown manager | `src/index.ts` | Stop issue sync scheduler on shutdown |

### Components NOT Modified

| Component | Why Unchanged |
|-----------|---------------|
| IssueStore (`knowledge/issue-store.ts`) | Already has `upsert`, `findSimilar`, `searchByEmbedding`, `searchByFullText` -- all needed methods exist |
| Issue schema (`014-issues.sql`) | Schema is complete; no new columns needed for these features |
| MCP tools (`issue-label-server.ts`, `issue-comment-server.ts`) | Already built for triage in v0.21; reused as-is |
| Triage agent core (`triage/triage-agent.ts`) | `validateIssue()`, `generateGuidanceComment()`, `generateLabelRecommendation()` are pure functions; reused directly |
| Webhook router (`webhook/router.ts`) | Generic event dispatch; just needs new registrations |
| Job queue (`jobs/queue.ts`) | Existing p-queue with per-installation concurrency; new handlers enqueue jobs the same way |
| Mention handler (`handlers/mention.ts`) | v0.21 triage-on-mention path stays as-is; auto-triage is a separate handler |

## Component Details

### 1. Issue Backfill Module (`src/knowledge/issue-backfill.ts`)

**Pattern:** Follows `src/knowledge/review-comment-backfill.ts` exactly (paginated API, rate limiting, embedding, upsert).

**Data flow:**
```
GitHub Issues API (paginated, state=all, sort=created, direction=asc)
  -> For each issue:
     1. Embed "{title}\n\n{body}" via EmbeddingProvider
     2. Upsert to IssueStore (ON CONFLICT UPDATE handles re-runs)
     3. Fetch comments via Issues Comments API (paginated)
     4. Embed each comment body
     5. Upsert comments to IssueStore
  -> Adaptive rate limiting (1.5s/3s delays, matching review-comment-backfill)
```

**Key decisions:**
- **Include PRs in issue corpus:** Set `is_pull_request: true` for issues that are PRs. The schema already has this column. Enables PR-issue semantic search.
- **Embedding text:** Concatenate `"{title}\n\n{body}"` for issues, raw body for comments. Matches the semantic chunking approach used elsewhere.
- **Resumability:** Use `ON CONFLICT DO UPDATE` (existing upsert behavior). Idempotent re-runs update stale data without duplicates.
- **Bot filtering:** Skip comments from `dependabot`, `renovate`, `kodiai`, `github-actions`, `codecov` (reuse `DEFAULT_BOT_LOGINS` pattern from review-comment-backfill).
- **Scope control:** Accept `monthsBack` parameter (default: 36 for 3 years). xbmc/xbmc has ~15-20K issues total; 3 years captures the most relevant subset.

**Volume estimate for xbmc/xbmc (3 years):**
- ~5,000-8,000 issues
- At 1.5s rate limiting, ~3-4 hours for issues
- Comments add ~2x API calls; total ~6-8 hours
- Embedding cost: ~$5-10 (Voyage AI at $0.001/embed)

### 2. Issue Sync Scheduler (`src/knowledge/issue-sync.ts`)

**Pattern:** Follows `src/knowledge/wiki-sync.ts` (nightly setInterval scheduler with startup delay) and `src/knowledge/cluster-scheduler.ts` (same scheduler pattern).

**Data flow:**
```
setInterval (24h, 150s startup delay)
  -> GitHub Issues API with `since` parameter (issues updated since last sync)
  -> For each updated issue:
     1. Re-embed title + body
     2. Upsert to IssueStore (ON CONFLICT UPDATE)
     3. Fetch new/updated comments
     4. Embed and upsert comments
  -> Track last-sync timestamp (use knowledge_store run_state or a dedicated key)
```

**Integration in `src/index.ts`:**
```typescript
// Issue sync scheduler (nightly incremental sync)
const issueSyncScheduler = embeddingProvider
  ? createIssueSyncScheduler({
      store: issueStore,
      embeddingProvider,
      githubApp,
      repo: `${config.wikiGithubOwner}/${config.wikiGithubRepo}`,
      logger,
    })
  : null;
if (issueSyncScheduler) {
  issueSyncScheduler.start();
  _issueSyncSchedulerRef = issueSyncScheduler;
}
```

**Startup delay staggering:**
- Wiki sync: 60s
- Staleness detector: 90s
- Cluster scheduler: 120s
- Issue sync: 150s (new, avoids startup thundering herd)

### 3. Duplicate Detector (`src/knowledge/issue-duplicate-detector.ts`)

**Pure function module -- no state, no side effects beyond IssueStore reads.**

```typescript
type DuplicateCandidate = {
  issueNumber: number;
  title: string;
  state: string;       // "open" or "closed"
  distance: number;    // cosine distance (lower = more similar)
  confidence: "definite" | "likely" | "possible";
  url: string;         // GitHub issue URL
};

type DuplicateResult = {
  candidates: DuplicateCandidate[];
  hasHighConfidence: boolean;  // at least one "definite" or "likely"
};

async function detectDuplicates(params: {
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  repo: string;
  title: string;
  body: string | null;
  topK?: number;               // default 5
  threshold?: number;          // default 0.25 (max distance to consider)
  highConfidenceThreshold?: number;  // default 0.12 (below = definite)
  likelyThreshold?: number;         // default 0.18 (below = likely)
}): Promise<DuplicateResult>
```

**Algorithm:**
```
New issue title + body
  -> Embed "{title}\n\n{body}" via EmbeddingProvider
  -> IssueStore.searchByEmbedding(embedding, repo, topK=5)
  -> Filter results by max distance threshold (0.25)
  -> Classify: "definite" (< 0.12), "likely" (0.12-0.18), "possible" (0.18-0.25)
  -> Return ranked candidates
```

**Why no LLM call:** Vector similarity with tight thresholds is sufficient for high-confidence detection and costs ~$0.001 per check (one embedding call). LLM validation ($0.10-0.50) can be added later for borderline cases.

**Why `searchByEmbedding` over `findSimilar`:** `findSimilar()` requires the issue to already exist in the corpus (looks up the stored embedding). For `issues.opened`, the issue hasn't been ingested yet, so we must embed the new text and query directly.

### 4. PR-Issue Linker (`src/handlers/pr-issue-linker.ts`)

**Triggers on:** `pull_request.opened` (new event router registration)

**Two-signal linking:**

**Signal 1: Reference parsing (deterministic, always runs)**
```
PR title + body
  -> Regex: /(?:fix(?:es|ed)?|clos(?:es|ed)?|resolv(?:es|ed)?)\s+#(\d+)/gi
  -> Regex: /(?:relates?\s+to|ref(?:s|erences?)?)\s+#(\d+)/gi
  -> Regex: bare /#(\d+)/ with word boundary
  -> Extract issue numbers
  -> Verify each exists via IssueStore.getByNumber (fast DB lookup)
  -> Confidence: HIGH (explicit close keyword) or MEDIUM (bare reference)
```

**Signal 2: Semantic search (embedding-based, only if embeddingProvider available)**
```
PR title + first 500 chars of body
  -> Embed via EmbeddingProvider
  -> IssueStore.searchByEmbedding(embedding, repo, topK=3)
  -> Filter: distance < 0.25, exclude already-linked issues from Signal 1
  -> Confidence: LOW (semantic only)
```

**Output:**
- Store links in a new `pr_issue_links` table (new migration 015)
- For HIGH confidence: post informational comment on PR (fire-and-forget, non-blocking)
- For MEDIUM/LOW: store only, available for retrieval context enrichment

**New migration `015-pr-issue-links.sql`:**
```sql
CREATE TABLE IF NOT EXISTS pr_issue_links (
  id BIGSERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  issue_number INTEGER NOT NULL,
  link_type TEXT NOT NULL,     -- 'closes', 'fixes', 'relates', 'semantic'
  confidence TEXT NOT NULL,    -- 'high', 'medium', 'low'
  distance REAL,               -- cosine distance for semantic links, NULL for reference links
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo, pr_number, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_pr_issue_links_repo_pr
  ON pr_issue_links (repo, pr_number);
CREATE INDEX IF NOT EXISTS idx_pr_issue_links_repo_issue
  ON pr_issue_links (repo, issue_number);
```

### 5. Auto-Triage Handler (`src/handlers/issue-opened.ts`)

**Triggers on:** `issues.opened` (new event router registration -- separate handler, NOT inside mention handler)

**Why a separate handler (not mention handler):** The `issues.opened` event is structurally different from `issue_comment.created`. There is no mention to detect, no comment body to parse, and no `@kodiai` trigger. The mention handler's flow (mention check, write-intent parsing, conversation context) does not apply. A clean, focused handler avoids polluting the already-2000-line mention handler.

**Orchestration flow:**
```
issues.opened webhook
  1. Config gate: load .kodiai.yml, check triage.autoTriageOnOpen (default: false)
  2. Idempotency: check for existing kodiai comment on the issue (GitHub API search)
  3. Parallel execution:
     a. Triage validation (reuse triage-agent.ts validateIssue)
        - Fetch .github/ISSUE_TEMPLATE/ via GitHub Contents API (no workspace clone)
        - Run template diff against issue body
     b. Duplicate detection (new duplicate-detector.ts)
        - Embed issue title + body
        - Search IssueStore for similar issues
     c. Ingest into corpus (IssueStore.upsert with embedding)
  4. Compose response:
     - If high-confidence duplicates: "Possible duplicate of #X, #Y"
     - If triage validation failed: guidance comment (existing generator)
     - If both: combined comment
     - If neither: no comment (silent pass)
  5. Apply labels via MCP tool (if triage recommends)
  6. Update cooldown map (reuse pattern from mention handler)
```

**Template fetching without workspace clone:**
The triage agent currently reads templates from the cloned workspace filesystem. For `issues.opened`, we skip the 30-60s clone and instead fetch templates via GitHub Contents API:
```typescript
// Fetch template directory listing
const { data: entries } = await octokit.rest.repos.getContent({
  owner, repo, path: ".github/ISSUE_TEMPLATE"
});
// Fetch each .md file
for (const entry of entries.filter(e => e.name.endsWith('.md'))) {
  const { data } = await octokit.rest.repos.getContent({
    owner, repo, path: entry.path, mediaType: { format: 'raw' }
  });
  // Parse template from raw content
}
```
This requires a small adapter: either modify `validateIssue()` to accept template content directly (instead of a workspace dir), or create a `fetchTemplatesViaApi()` function that produces the same `TemplateDefinition[]` that `validateIssue` internally builds.

**Config schema extension:**
```typescript
const triageSchema = z.object({
  enabled: z.boolean().default(false),
  autoTriageOnOpen: z.boolean().default(false),  // NEW
  duplicateDetection: z.object({                  // NEW
    enabled: z.boolean().default(true),
    threshold: z.number().min(0).max(1).default(0.18),
    highConfidenceThreshold: z.number().min(0).max(1).default(0.12),
  }).default({ enabled: true, threshold: 0.18, highConfidenceThreshold: 0.12 }),
  label: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  comment: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  labelAllowlist: z.array(z.string()).default([]),
  cooldownMinutes: z.number().min(0).max(1440).default(30),
});
```

### 6. Issue Corpus in Cross-Corpus Retrieval

**Modified files:** `cross-corpus-rrf.ts`, `retrieval.ts`, new `issue-retrieval.ts`

Add issue corpus as 5th source in the unified retrieval pipeline:

```typescript
// cross-corpus-rrf.ts -- extend SourceType
export type SourceType = "code" | "review_comment" | "wiki" | "snippet" | "issue";

// retrieval.ts -- add source weights
const SOURCE_WEIGHTS: Record<TriggerType, Record<string, number>> = {
  pr_review: { code: 1.2, review_comment: 1.2, wiki: 1.0, snippet: 1.1, issue: 0.8 },
  issue:     { code: 1.0, review_comment: 1.0, wiki: 1.2, snippet: 0.8, issue: 1.3 },
  question:  { code: 1.0, review_comment: 1.0, wiki: 1.2, snippet: 0.8, issue: 1.0 },
  slack:     { code: 1.0, review_comment: 1.0, wiki: 1.0, snippet: 1.0, issue: 1.0 },
};
```

**New issue retrieval helper** (`src/knowledge/issue-retrieval.ts`):
Follows `review-comment-retrieval.ts` and `wiki-retrieval.ts` pattern -- performs hybrid search (embedding + BM25) and returns `RankedSourceList` for RRF merging.

## Data Flow Changes Summary

### Before (v0.21)

```
Webhook -> Router -> Mention Handler -> [triage if @kodiai mentioned + triage.enabled]
                                     -> Retrieval: code + review + wiki + snippet (4 corpora)
```

### After (v0.22)

```
Webhook -> Router -> issues.opened     -> Auto-Triage Handler -> Duplicate Detector
                                                              -> Triage Validation
                                                              -> IssueStore upsert
                  -> PR opened         -> PR-Issue Linker -> Reference Parser
                                                          -> Semantic Search
                  -> issue_comment     -> Mention Handler (unchanged)
                                       -> Retrieval: code + review + wiki + snippet + issue (5 corpora)

Scheduled -> Issue Sync (nightly) -> GitHub Issues API -> IssueStore upserts
One-shot  -> Backfill script -> GitHub Issues API -> IssueStore bulk upserts
```

## Build Order (Dependency-Driven)

### Phase 1: Historical Ingestion + Nightly Sync

**Why first:** Everything downstream depends on having issues in the corpus. Duplicate detection needs embeddings to compare against. PR-issue linking needs issue records to verify references. Retrieval integration needs issue data.

**Deliverables:**
1. Issue backfill module (`src/knowledge/issue-backfill.ts`) + tests
2. Backfill CLI script (`scripts/backfill-issues.ts`)
3. Issue sync scheduler (`src/knowledge/issue-sync.ts`) + tests
4. Wire sync scheduler into `src/index.ts` (init, shutdown)

**Dependencies:** IssueStore (exists), EmbeddingProvider (exists), GitHubApp (exists)

### Phase 2: Duplicate Detection + Auto-Triage on issues.opened

**Why second:** Core user-facing intelligence feature. Needs populated corpus from Phase 1.

**Deliverables:**
1. Duplicate detector (`src/knowledge/issue-duplicate-detector.ts`) + tests
2. Config schema extension (autoTriageOnOpen, duplicateDetection)
3. Template fetching via Contents API (adapter for triage-agent.ts)
4. Auto-triage handler (`src/handlers/issue-opened.ts`) + tests
5. Wire into event router in `src/index.ts`

**Dependencies:** IssueStore (exists), Triage Agent (exists), MCP tools (exist), Duplicate Detector (this phase)

### Phase 3: PR-Issue Linking

**Why third:** Builds on populated corpus. Independent of auto-triage.

**Deliverables:**
1. Migration `015-pr-issue-links.sql`
2. Reference parser (regex extraction from PR title/body)
3. PR-Issue linker handler (`src/handlers/pr-issue-linker.ts`) + tests
4. Wire into event router (`pull_request.opened`)

**Dependencies:** IssueStore (exists), EmbeddingProvider (exists), migration 015 (this phase)

### Phase 4: Issue Corpus in Retrieval Pipeline

**Why last:** Enhancement to existing pipeline. Lower priority than the three user-facing features. All other phases deliver value without this.

**Deliverables:**
1. Issue retrieval helper (`src/knowledge/issue-retrieval.ts`) + tests
2. Update `SourceType` union in `cross-corpus-rrf.ts`
3. Wire issue search into `retrieval.ts` fan-out
4. Update source weights per trigger type
5. Add `[issue: #N]` citation format for mention/review responses

**Dependencies:** IssueStore (exists), retrieval pipeline (exists), populated corpus (Phase 1)

## Anti-Patterns to Avoid

### Anti-Pattern 1: Agent Loop for Duplicate Detection
**What:** Running a Claude agent to determine if issues are duplicates.
**Why bad:** Costs $0.10-0.50 per `issues.opened`. Vector similarity at tight thresholds (cosine distance < 0.12) is sufficient for high-confidence detection and costs ~$0.001 (one embedding call).
**Instead:** Pure embedding comparison. Reserve LLM validation for a future iteration on borderline cases.

### Anti-Pattern 2: Workspace Clone for Auto-Triage
**What:** Creating a shallow clone workspace to read issue templates (as the mention handler does for triage-on-mention).
**Why bad:** Cloning xbmc/xbmc takes 30-60 seconds. Auto-triage on `issues.opened` should respond quickly (<5s for the non-LLM path).
**Instead:** Fetch `.github/ISSUE_TEMPLATE/` via GitHub Contents API (2-5 REST calls, <2s).

### Anti-Pattern 3: Blocking PR Review for Issue Linking
**What:** Making PR-issue linking a prerequisite step in the review pipeline.
**Why bad:** Adds latency to the critical PR review path. Issue linking is informational.
**Instead:** Separate handler registered on `pull_request.opened`. Runs independently via Promise.allSettled in the event router.

### Anti-Pattern 4: Re-embedding Entire Corpus on Nightly Sync
**What:** Re-generating embeddings for all issues every night.
**Why bad:** Wastes embedding API budget. Only changed issues need re-embedding.
**Instead:** Use GitHub's `since` parameter to fetch only updated issues. Compare `github_updated_at` to skip unchanged records.

### Anti-Pattern 5: Adding Triage to Mention Handler for issues.opened
**What:** Routing `issues.opened` through the mention handler by registering it there.
**Why bad:** The mention handler assumes a comment exists, checks for `@kodiai` mention, parses write-intent, builds conversation context. None of this applies to `issues.opened` (no comment, no mention, no conversation). The handler is already 2000+ lines.
**Instead:** Clean, focused `issue-opened.ts` handler (~200 lines) registered separately on the event router.

## Scalability Considerations

| Concern | Current (xbmc/xbmc) | At 10 Repos | At 100 Repos |
|---------|---------------------|-------------|--------------|
| Issue corpus size | ~5-8K issues (3yr) | ~50K issues | ~500K issues |
| HNSW index | Fine (< 100K) | Fine (< 100K) | Consider repo-scoped partitioning |
| Backfill duration | 6-8 hours one-time | Run per-repo sequentially | Queue-based with priority |
| Nightly sync API calls | ~50-200 | ~500-2000 | Rate limit coordination |
| Embedding costs | ~$5-10 backfill | ~$50-100 | Budget alerts needed |
| Auto-triage latency | <3s (embed + search) | Same (repo-scoped) | Same (repo-scoped) |
| PR-issue links table | ~5K rows over time | ~50K rows | Indexed, no concern |

## Sources

- Codebase analysis: `review-comment-backfill.ts` (backfill pattern), `wiki-sync.ts` (nightly scheduler), `cluster-scheduler.ts` (setInterval + startup delay), `issue-store.ts` (existing CRUD + search API), `triage-agent.ts` (template validation), `cross-corpus-rrf.ts` (RRF merging), `mention.ts` (triage-on-mention integration, event registration patterns)
- Existing schema: `014-issues.sql` (issues + issue_comments with HNSW + tsvector)
- Event router: `webhook/router.ts` (Promise.allSettled dispatch, handler isolation)
- Scheduled jobs: `wiki-sync.ts` (60s delay), `wiki-staleness-detector.ts` (90s), `cluster-scheduler.ts` (120s)
- IssueStore API: `upsert`, `findSimilar`, `searchByEmbedding`, `searchByFullText`, `upsertComment`, `getByNumber`, `countByRepo`

---
*Architecture research for v0.22 Issue Intelligence features*
*Researched: 2026-02-26*

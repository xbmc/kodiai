# Stack Research: v0.22 Issue Intelligence

**Domain:** Historical issue ingestion, duplicate detection, PR-issue linking, auto-triage for GitHub App
**Researched:** 2026-02-26
**Confidence:** HIGH

## Scope

This research covers ONLY what is needed for the v0.22 milestone: bulk historical issue ingestion from GitHub API, nightly incremental sync scheduling, vector-similarity duplicate detection, PR-issue linking, and auto-triage on `issues.opened`. The existing stack is validated and not re-evaluated.

## Recommended Stack Additions: NONE

No new npm packages are required. Every capability for v0.22 is already available in the existing dependency tree. This milestone is a feature-layer build on validated infrastructure.

| Capability Needed | Provided By | Already Installed | Version |
|-------------------|-------------|-------------------|---------|
| Paginated issue list (bulk + incremental) | `@octokit/rest` `octokit.paginate.iterator()` | Yes | ^22.0.1 |
| Issue comment fetching | `@octokit/rest` `issues.listComments()` | Yes | ^22.0.1 |
| Issue/comment upsert with embeddings | `issue-store.ts` (`IssueStore`) | Yes | Custom |
| Vector similarity search (duplicate detection) | PostgreSQL pgvector `<=>` operator | Yes | HNSW indexed |
| Full-text search (duplicate detection BM25 leg) | PostgreSQL `tsvector` + `ts_rank()` | Yes | GIN indexed |
| Embedding generation | `voyageai` (`voyage-code-3`, 1024d) | Yes | ^0.1.0 |
| Scheduled nightly job | `setInterval` + startup delay pattern | Yes | Built-in JS |
| Webhook event dispatch (`issues.opened`) | `createEventRouter` key-based dispatch | Yes | Custom |
| Config gating (`triage.enabled`) | `.kodiai.yml` + `triageSchema` (Zod) | Yes | Custom |
| Rate limit awareness | Adaptive delay from `x-ratelimit-remaining` headers | Yes | Pattern in `review-comment-backfill.ts` |
| Schema migrations | `src/db/migrate.ts` sequential migration runner | Yes | Custom |
| PR search (for PR-issue linking) | `@octokit/rest` `search.issuesAndPullRequests()` | Yes | ^22.0.1 |
| JSON body parsing + reference extraction | Built-in string/regex operations | Yes | Runtime |

## Integration Points (How New Code Connects)

### 1. Historical Issue Backfill

**Pattern to follow:** `src/knowledge/review-comment-backfill.ts`

The review comment backfill is the exact template. It uses:
- `octokit.paginate.iterator()` for memory-efficient streaming pagination
- Adaptive rate delay reading `x-ratelimit-remaining` headers
- Sync state table for cursor-based resume (`backfillComplete` flag, `lastSyncedAt`)
- Per-page embedding generation with fail-open semantics
- `ON CONFLICT DO UPDATE` upsert for idempotent re-runs

The issue backfill should follow this pattern identically, using:
- `GET /repos/{owner}/{repo}/issues` with `state: "all"`, `sort: "updated"`, `direction: "asc"`, `per_page: 100`
- Filter out PRs via `pull_request` key presence (GitHub API returns issues+PRs together)
- For each issue, also fetch comments via `GET /repos/{owner}/{repo}/issues/{issue_number}/comments`
- Embed `title + "\n\n" + body` as the issue embedding (title carries high signal for duplicates)
- Use existing `IssueStore.upsert()` and `IssueStore.upsertComment()`

**GitHub API consideration:** The `since` parameter on list issues filters by `updated_at`, not `created_at`. This is correct behavior for incremental sync (catches edits, state changes, new comments). For initial backfill, omit `since` and paginate through all issues.

**Volume estimate for xbmc/xbmc:** ~15,000-20,000 total issues (open + closed). At 100/page, that is 150-200 API pages for issues + additional pages for comments. Well within 5,000 req/hr rate limit with adaptive delays.

### 2. Nightly Incremental Sync Scheduler

**Pattern to follow:** `src/knowledge/wiki-sync.ts` (`createWikiSyncScheduler`)

The wiki sync scheduler is the exact template:
- Factory function returning `{ start(), stop(), syncNow() }`
- `setInterval` with startup delay (stagger after existing schedulers)
- Mutex flag (`running`) to prevent overlapping runs
- Fail-open with try/catch wrapping
- Wired in `src/index.ts` with `_schedulerRef` for shutdown cleanup

For issue sync:
- Default interval: `24 * 60 * 60 * 1000` (24 hours, matching wiki sync)
- Startup delay: `180_000` (3 minutes, staggered after wiki at 60s and cluster at 120s)
- Uses `since` parameter set to last sync timestamp
- Updates sync state after each batch

### 3. Duplicate Detection

**Already built:** `IssueStore.findSimilar()` does vector similarity with configurable threshold and excludes the source issue. This is the core primitive.

Additional needs for high-confidence duplicate detection:
- **Threshold tuning:** The existing default threshold of `0.7` (cosine distance) is a starting point. For "high-confidence" duplicate flagging, use `<= 0.25` cosine distance (equivalent to >= 0.75 cosine similarity). This avoids false positives.
- **Hybrid signal:** Combine vector similarity with title BM25 overlap for higher precision. Two signals agreeing = higher confidence.
- **No new dependencies needed.** The `<=>` pgvector operator and `ts_rank()` are both already used.

### 4. PR-Issue Linking

Two linking strategies, both using existing tools:

**Reference-based (deterministic):** Parse issue/PR bodies and comments for patterns like `fixes #123`, `closes #456`, `resolves #789`, `ref #101`. This is pure string/regex work -- no dependencies.

**Semantic search (fuzzy):** Use `octokit.rest.search.issuesAndPullRequests()` to find PRs that reference an issue number, or embed the issue title and search PR titles/bodies via the existing retrieval pipeline. Octokit search is already used elsewhere in the codebase (`ci-failure.ts`, `issue-label-server.ts`).

### 5. Auto-Triage on `issues.opened`

**Pattern to follow:** `src/webhook/router.ts` event registration

The router already supports `"issues.opened"` as a dispatch key. Register a new handler:
```typescript
router.register("issues.opened", handleIssuesOpened);
```

The handler should:
1. Load repo config, check `triage.enabled` (and a new `triage.autoTriage` boolean)
2. Check per-issue cooldown (reuse existing `triageCooldowns` map logic from `mention.ts`)
3. Run the existing triage validation agent
4. Run duplicate detection
5. Apply labels and post comment via existing MCP tools

**Idempotency:** Use the existing `checkAndClaimRun()` pattern from `KnowledgeStore` keyed on `repo + issueNumber + "triage"` to prevent duplicate processing on webhook redelivery.

## Schema Additions

New migration needed for:

```sql
-- Issue sync state table (follows review_comment_sync_state pattern)
CREATE TABLE IF NOT EXISTS issue_sync_state (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ,
  last_page_cursor TEXT,
  total_issues_synced INTEGER DEFAULT 0,
  backfill_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PR-issue links table
CREATE TABLE IF NOT EXISTS pr_issue_links (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  issue_number INTEGER NOT NULL,
  link_type TEXT NOT NULL,  -- 'reference', 'semantic', 'closes'
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo, pr_number, issue_number, link_type)
);
CREATE INDEX idx_pr_issue_links_issue ON pr_issue_links(repo, issue_number);
CREATE INDEX idx_pr_issue_links_pr ON pr_issue_links(repo, pr_number);
```

No changes to existing `issues` or `issue_comments` tables -- the schema from v0.21 already has all needed columns including `embedding`, `state`, `is_pull_request`, `label_names`.

## Config Additions

Extend the existing `triageSchema` in `src/execution/config.ts`:

```typescript
const triageSchema = z.object({
  enabled: z.boolean().default(false),
  // NEW for v0.22:
  autoTriage: z.boolean().default(false), // fire on issues.opened
  duplicateDetection: z.object({
    enabled: z.boolean().default(true),
    threshold: z.number().min(0).max(1).default(0.25), // cosine distance
  }).default({ enabled: true, threshold: 0.25 }),
  // existing fields unchanged...
  label: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  comment: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  labelAllowlist: z.array(z.string()).default([]),
  cooldownMinutes: z.number().min(0).max(1440).default(30),
}).default({});
```

## Alternatives Considered

| Need | Recommended | Alternative | Why Not |
|------|-------------|-------------|---------|
| Pagination | `octokit.paginate.iterator()` | Manual page loop | Iterator handles Link header parsing, memory-efficient streaming |
| Scheduling | `setInterval` + startup delay | node-cron, bull, BullMQ | Existing pattern works, single-instance deployment, no Redis needed |
| Duplicate detection | pgvector `<=>` + BM25 hybrid | Dedicated dedup library | Already have both search primitives, just need threshold tuning |
| Reference parsing | Regex extraction | GitHub timeline API | Timeline API is expensive (1 call/issue); regex is instant and deterministic |
| PR search | Octokit `search.issuesAndPullRequests` | GraphQL API | REST search is simpler, already used elsewhere, sufficient for this use case |

## What NOT to Add

| Library | Why Avoid |
|---------|-----------|
| `node-cron` / `cron` | `setInterval` pattern is already established for 3 schedulers; adding cron syntax adds complexity for no benefit at single-instance scale |
| `bull` / `bullmq` | Requires Redis; in-process scheduling is sufficient for nightly jobs on single instance |
| GraphQL (`@octokit/graphql`) | REST API is sufficient for all v0.22 operations; GraphQL adds query complexity |
| Dedicated NLP/dedup libraries | pgvector + BM25 already provide the duplicate detection primitives |
| `p-limit` / `p-throttle` | Adaptive rate delay from headers is already the pattern; no need for generic throttling |

## Embedding Strategy

**Issue embedding text:** Concatenate `title + "\n\n" + body` (truncated to reasonable length). Title is critical for duplicate detection -- many issues have similar titles but different bodies. The existing `EmbeddingProvider.generate()` interface handles this directly.

**Comment embedding text:** Use `body` directly, same as existing `IssueCommentInput.embedding` field.

**Model:** `voyage-code-3` at 1024 dimensions, matching all other corpora. No model change needed.

**Batch embedding consideration:** VoyageAI supports batch embedding (multiple texts per API call). The existing `EmbeddingProvider` interface is single-text. For backfill performance, consider adding a `generateBatch()` method or simply rate-limit sequential calls with adaptive delays (matching the review comment backfill approach). Sequential is simpler and proven.

## Sources

- [GitHub REST API: List Repository Issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues) -- `state`, `since`, `sort`, `direction`, `per_page` parameters; returns issues+PRs together
- [GitHub REST API: Pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api) -- Link header, per_page max 100
- Existing codebase patterns: `review-comment-backfill.ts` (backfill), `wiki-sync.ts` (scheduler), `cluster-scheduler.ts` (scheduler), `issue-store.ts` (CRUD + search), `router.ts` (event dispatch)

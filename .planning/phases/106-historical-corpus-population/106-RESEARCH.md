# Phase 106: Historical Corpus Population - Research

**Researched:** 2026-02-26
**Domain:** GitHub Issues API ingestion, Voyage AI embedding, PostgreSQL pgvector storage
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Comment embedding strategy
- One vector per comment (not concatenated into issue body)
- Each comment embedding is prefixed with parent issue context: "Issue #N: [title]" so the vector captures what the comment is about
- Bot-generated comments (e.g., [bot] suffix, CI status, stale bot) are filtered out -- not embedded
- Long comments are chunked into multiple vectors with overlap, not truncated

#### Backfill invocation & UX
- Standalone TypeScript script in scripts/ (e.g., scripts/backfill-issues.ts), not a CLI subcommand
- Accepts --repo owner/name parameter with xbmc/xbmc as default -- allows testing on smaller repos
- Progress output uses structured log lines (JSON-style): page count, issues processed, embeddings created, rate limit remaining
- Cursor/resume state stored in the database (sync_state table or metadata row), not a local file

#### Nightly sync trigger
- GitHub Action on cron schedule triggers the sync
- Same script as backfill, invoked with --sync flag for incremental mode
- Sync uses stored last-sync timestamp -- fetches issues with updated_at > last_sync, no fixed lookback window
- Never deletes from corpus -- deleted GitHub issues are kept for historical value

#### Error & rate limit handling
- On GitHub rate limit: sleep until x-ratelimit-reset, then auto-resume -- backfill completes unattended
- On Voyage AI embedding failure: log the failed issue number, skip it, continue -- one bad issue doesn't block the rest
- Uses GitHub App installation token (kodiai's existing credentials) for higher rate limits
- Prints summary report at end: total issues, comments embedded, failures skipped, duration, API calls used

### Claude's Discretion

No specific requirements -- open to standard approaches

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INGEST-01 | Backfill script populates issue corpus with historical xbmc/xbmc issues and their comment threads | Backfill pattern from `review-comment-backfill.ts`; IssueStore.upsert() and upsertComment() already exist |
| INGEST-02 | Each backfilled issue is embedded via Voyage AI (title + body) with HNSW-indexed vectors | EmbeddingProvider.generate() exists; HNSW index already in migration 014; voyage-code-3 1024 dims |
| INGEST-03 | Backfill script filters out pull requests returned by GitHub Issues API | GitHub Issues API returns PRs with `pull_request` key; filter by checking field presence |
| INGEST-04 | Backfill tracks sync state for cursor-based resume on interruption | `review_comment_sync_state` table pattern; needs new `issue_sync_state` table in migration 015 |
| INGEST-05 | Backfill logs progress with page counts, embedding counts, rate limit status | Pino structured logging; follow `review-comment-backfill.ts` batch logging pattern |
| INGEST-06 | Nightly sync fetches issues updated since last sync and upserts with fresh embeddings | GitHub Issues API `since` parameter; same script with `--sync` flag |
| INGEST-07 | Nightly sync also syncs new and updated issue comments | `GET /repos/{owner}/{repo}/issues/comments` with `since` parameter for repo-wide comment sync |

</phase_requirements>

## Summary

This phase builds a backfill script and nightly sync for populating the `issues` and `issue_comments` tables (from Phase 105 migration 014) with all xbmc/xbmc issues. The project already has two battle-tested backfill patterns: `review-comment-backfill.ts` (for PR review comments) and `wiki-backfill.ts` (for wiki pages). Both follow the same architecture: paginated API fetch, embedding generation, store upsert, sync state tracking, and structured logging. This phase clones that pattern for issues.

The xbmc/xbmc repository has approximately **4,898 issues** (excluding ~22,953 PRs). The GitHub Issues API returns both issues and PRs together, so the script must filter by the presence of the `pull_request` field. At 100 items per page with `state=all`, the backfill needs ~50 pages for issues plus additional pages for fetching comments per issue. GitHub App installation tokens provide 5,000+ requests/hour. Voyage AI allows 2,000 RPM for voyage-code-3 at the basic tier.

The IssueStore with `upsert()` and `upsertComment()` methods already exists from Phase 105. The EmbeddingProvider (Voyage AI wrapper with fail-open semantics) is also production-ready. What is missing: (1) an `issue_sync_state` database table for tracking backfill progress, (2) the backfill/sync engine in `src/knowledge/`, (3) a comment chunker for long comments, (4) the CLI script in `scripts/`, and (5) a GitHub Actions workflow for nightly sync.

**Primary recommendation:** Follow the `review-comment-backfill.ts` pattern exactly -- paginated GitHub API fetch, per-page sync state persistence, adaptive rate delay, fail-open embedding, structured pino logging -- adapting it for the Issues and Issue Comments API endpoints.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @octokit/rest | existing | GitHub API client (paginated list issues + comments) | Already used in review-comment-backfill |
| voyageai | existing | Embedding generation via EmbeddingProvider | Existing wrapper with fail-open semantics |
| postgres (via Sql) | existing | Store to `issues` and `issue_comments` tables | Existing createDbClient + IssueStore |
| pino | existing | Structured JSON logging | Project standard for all scripts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:util (parseArgs) | built-in | CLI argument parsing | Script entry point for --repo, --sync, --dry-run |
| Bun.file | built-in | Read GitHub App private key from file | Script bootstrap |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-issue comment fetch | Repo-wide comment fetch | Repo-wide (`/repos/{o}/{r}/issues/comments`) is O(pages) vs O(issues) for per-issue fetch -- much faster for full backfill |
| Single embed per call | Batch embed array | Voyage AI supports array input, but EmbeddingProvider wraps single calls with fail-open; keep consistent |

**Installation:**
```bash
# No new dependencies needed -- all libraries already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/knowledge/
├── issue-backfill.ts          # Core backfill + sync engine (like review-comment-backfill.ts)
├── issue-backfill.test.ts     # Tests with mocked Octokit/store/embedding
├── issue-comment-chunker.ts   # Chunk long comments with overlap (like review-comment-chunker.ts)
├── issue-comment-chunker.test.ts
├── issue-store.ts             # Already exists (Phase 105)
├── issue-types.ts             # Already exists (Phase 105)
scripts/
├── backfill-issues.ts         # CLI entry point (like backfill-review-comments.ts)
src/db/migrations/
├── 015-issue-sync-state.sql   # New migration: issue_sync_state table
├── 015-issue-sync-state.down.sql
.github/workflows/
├── nightly-issue-sync.yml     # GitHub Action cron trigger
```

### Pattern 1: Paginated Backfill with Sync State Resume
**What:** Page through GitHub Issues API, persist sync state after each page, resume from last page on restart.
**When to use:** Any large corpus backfill that can be interrupted.
**Example:**
```typescript
// Source: review-comment-backfill.ts (existing project pattern)
// 1. Check sync state for resume point
const syncState = await store.getSyncState(repo);
let sinceDate: Date;
if (syncState?.lastSyncedAt) {
  sinceDate = syncState.lastSyncedAt;
  resumed = true;
} else {
  // Fresh backfill: start from epoch
}

// 2. Paginate
while (true) {
  const response = await octokit.rest.issues.listForRepo({
    owner, repo: repoName,
    state: "all",
    sort: "updated",
    direction: "asc",
    since: sinceDate.toISOString(),
    per_page: 100,
    page,
  });

  // 3. Filter PRs, embed, upsert
  const issues = response.data.filter(i => !i.pull_request);
  for (const issue of issues) { /* embed + upsert */ }

  // 4. Persist sync state after each page
  await updateSyncState({ repo, lastSyncedAt, page, totalIssuesSynced });

  if (response.data.length < 100) break;
  page++;
}
```

### Pattern 2: Comment Chunking with Issue Context Prefix
**What:** Prefix each comment embedding text with parent issue context so the vector captures topic.
**When to use:** Each issue comment is embedded independently.
**Example:**
```typescript
// Source: User decision from CONTEXT.md
function buildCommentEmbeddingText(
  issueNumber: number,
  issueTitle: string,
  commentBody: string,
): string {
  return `Issue #${issueNumber}: ${issueTitle}\n\n${commentBody}`;
}

// For long comments, chunk with sliding window (1024 tokens, 256 overlap)
// Same approach as review-comment-chunker.ts
```

### Pattern 3: Adaptive Rate Delay (GitHub)
**What:** Read `x-ratelimit-remaining` and `x-ratelimit-reset` headers; add delay proportional to remaining budget, sleep until reset if exhausted.
**When to use:** Any GitHub API pagination loop.
**Example:**
```typescript
// Source: review-comment-backfill.ts (existing project pattern)
async function adaptiveRateDelay(headers, logger, pageNum): Promise<void> {
  const remaining = parseInt(headers["x-ratelimit-remaining"] ?? "5000", 10);
  const limit = parseInt(headers["x-ratelimit-limit"] ?? "5000", 10);
  const ratio = remaining / limit;

  if (ratio < 0.2) { await sleep(3000); }
  else if (ratio < 0.5) { await sleep(1500); }
}

// NEW for this phase: hard sleep-until-reset when remaining === 0
async function waitForRateReset(headers, logger): Promise<void> {
  const remaining = parseInt(headers["x-ratelimit-remaining"] ?? "1", 10);
  if (remaining > 0) return;

  const resetEpoch = parseInt(headers["x-ratelimit-reset"] ?? "0", 10);
  const waitMs = (resetEpoch * 1000) - Date.now() + 1000; // +1s buffer
  if (waitMs > 0) {
    logger.warn({ waitMs, resetAt: new Date(resetEpoch * 1000).toISOString() },
      "Rate limit exhausted -- sleeping until reset");
    await sleep(waitMs);
  }
}
```

### Pattern 4: Dual-Mode Script (Backfill vs Sync)
**What:** Single script with `--sync` flag for incremental mode.
**When to use:** Backfill + nightly sync share 95% of code.
**Example:**
```typescript
// scripts/backfill-issues.ts
const { values } = parseArgs({
  options: {
    repo: { type: "string", default: "xbmc/xbmc" },
    sync: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

if (values.sync) {
  // Incremental: fetch issues with updated_at > last_sync
  await syncIssues({ ...opts, mode: "incremental" });
} else {
  // Full backfill: fetch all issues state=all
  await backfillIssues({ ...opts });
}
```

### Anti-Patterns to Avoid
- **Fetching comments per-issue during backfill:** Use repo-wide `GET /repos/{o}/{r}/issues/comments` with `since` for backfill/sync. Per-issue fetch costs 1 API call per issue (4,898 calls vs ~100 pages).
- **Storing sync state in a local file:** Database sync state is the only durable option for CI/GitHub Actions.
- **Truncating long comments:** Decision says chunk with overlap, not truncate.
- **Embedding issue body with system info/logs:** Research note says "embed problem summary only (title + description section)". Consider trimming long bodies before embedding. The full body is still stored in the DB.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting for chunking | Full tokenizer | `countTokens()` from review-comment-chunker (whitespace split) | Good enough for chunk sizing; exact BPE tokenization is unnecessary |
| GitHub API pagination | Manual page tracking | Octokit pagination with manual page counter | Existing pattern works; `octokit.paginate()` helper exists but manual loop gives more control for sync state |
| Embedding generation | Direct Voyage AI HTTP calls | `createEmbeddingProvider()` | Handles retries, timeouts, fail-open semantics |
| Bot comment detection | Regex patterns | `isBot()` pattern from review-comment-chunker | Handles [bot] suffix, login allowlist |
| Database upsert | Raw SQL | `IssueStore.upsert()` and `upsertComment()` | Already built in Phase 105 with ON CONFLICT handling |

**Key insight:** Nearly all building blocks exist. The work is wiring them together in the backfill engine and adding the sync state migration.

## Common Pitfalls

### Pitfall 1: GitHub Issues API Returns PRs
**What goes wrong:** Ingesting PRs into the issue corpus pollutes similarity search results.
**Why it happens:** GitHub's Issues API treats every PR as an issue. `GET /repos/{o}/{r}/issues` returns both.
**How to avoid:** Filter each item by checking `item.pull_request` field presence. Items with this field are PRs -- skip them. The `is_pull_request` column exists in the schema for this purpose.
**Warning signs:** Issue count in corpus exceeds ~5,000 for xbmc/xbmc (should be ~4,898 issues, not ~27,800 issues+PRs).

### Pitfall 2: Rate Limit Exhaustion During Backfill
**What goes wrong:** Backfill hits GitHub API rate limit and crashes, requiring manual restart.
**Why it happens:** 4,898 issues at 100/page = ~280 pages of mixed issues+PRs, plus comment fetching.
**How to avoid:** (1) Read `x-ratelimit-remaining` header after each request. (2) When remaining hits 0, read `x-ratelimit-reset` header and sleep until that Unix timestamp. (3) Persist sync state after each page so interrupt+resume is cheap.
**Warning signs:** HTTP 403 response with `X-RateLimit-Remaining: 0`.

### Pitfall 3: Comment Fetch Strategy -- Per-Issue vs Repo-Wide
**What goes wrong:** Fetching comments per-issue for 4,898 issues burns 4,898+ API calls just for comments.
**Why it happens:** Naive approach: for each issue, call `GET /repos/{o}/{r}/issues/{n}/comments`.
**How to avoid:** Use `GET /repos/{o}/{r}/issues/comments?since=...&sort=created&direction=asc&per_page=100` for repo-wide comment fetch. This returns all comments across all issues in paginated form. Each comment includes `issue_url` from which the issue number can be extracted.
**Warning signs:** Backfill taking >1 hour for a repo with ~5,000 issues due to per-issue API calls.

### Pitfall 4: Voyage AI Rate Limiting on Bulk Embed
**What goes wrong:** Embedding ~5,000 issues + their comments overwhelms Voyage AI rate limits.
**Why it happens:** Basic tier: 2,000 RPM. If embedding at max speed, each issue + N comments = N+1 API calls.
**How to avoid:** Add a small delay between embedding calls (50-100ms). Monitor rate limit headers if Voyage AI provides them. Fail-open: skip failed embeddings, log them, continue.
**Warning signs:** Voyage AI 429 responses or timeout errors.

### Pitfall 5: GitHub Issues API `since` Parameter Semantics
**What goes wrong:** `since` on `/repos/{o}/{r}/issues` filters by `updated_at >= since`, but the response still includes issues that were updated before `since` if they match other filters.
**Why it happens:** GitHub's `since` parameter specifically means "only show issues that have been updated at or after this time." This is correct for incremental sync.
**How to avoid:** For backfill (no `since`), sort by `created` ascending. For sync, use `since` with `sort=updated&direction=asc`. Store the most recent `updated_at` value from the sync run as the new cursor.
**Warning signs:** Sync re-processing too many issues or missing recently updated issues.

### Pitfall 6: Comment `issue_url` Parsing for Issue Number
**What goes wrong:** When using repo-wide comment fetch, each comment has `issue_url` like `https://api.github.com/repos/xbmc/xbmc/issues/12345` -- must extract issue number.
**Why it happens:** Repo-wide comment endpoint does not directly include `issue_number` field.
**How to avoid:** Parse with regex: `/\/issues\/(\d+)$/`. Also store `issue_url` -> `issue_number` mapping.
**Warning signs:** Comments not linked to correct issues, or parseInt failures.

## Code Examples

### Migration 015: issue_sync_state table
```sql
-- 015-issue-sync-state.sql
-- Sync state tracking for issue corpus backfill and nightly sync.

CREATE TABLE IF NOT EXISTS issue_sync_state (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL UNIQUE,
  last_synced_at TIMESTAMPTZ,
  last_page_cursor TEXT,
  total_issues_synced INTEGER NOT NULL DEFAULT 0,
  total_comments_synced INTEGER NOT NULL DEFAULT 0,
  backfill_complete BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Bot Comment Detection
```typescript
// Source: review-comment-chunker.ts (existing project pattern)
const BOT_LOGINS = new Set([
  "dependabot", "renovate", "kodiai", "github-actions",
  "codecov", "stale", "kodi-butler",
]);

function isBotComment(login: string): boolean {
  const lower = login.toLowerCase();
  return BOT_LOGINS.has(lower) || lower.endsWith("[bot]");
}
```

### Issue Embedding Text Construction
```typescript
// Per user decision: embed title + body (trimmed to description section)
function buildIssueEmbeddingText(title: string, body: string | null): string {
  if (!body) return title;
  // Research note: "embed problem summary only (title + description section)"
  // Full body stored in DB; embedding focuses on semantic core
  return `${title}\n\n${body}`;
}
```

### Comment Embedding with Issue Context Prefix
```typescript
// Per user decision: prefix with "Issue #N: [title]"
function buildCommentEmbeddingText(
  issueNumber: number,
  issueTitle: string,
  commentBody: string,
): string {
  return `Issue #${issueNumber}: ${issueTitle}\n\n${commentBody}`;
}
```

### GitHub Actions Nightly Sync Workflow
```yaml
# .github/workflows/nightly-issue-sync.yml
name: nightly-issue-sync

on:
  schedule:
    - cron: '0 3 * * *'  # 3 AM UTC daily
  workflow_dispatch:       # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - run: bun scripts/backfill-issues.ts --sync
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          GITHUB_APP_ID: ${{ secrets.GITHUB_APP_ID }}
          GITHUB_PRIVATE_KEY: ${{ secrets.GITHUB_PRIVATE_KEY }}
          VOYAGE_API_KEY: ${{ secrets.VOYAGE_API_KEY }}
```

### Extracting Issue Number from Comment's issue_url
```typescript
function extractIssueNumber(issueUrl: string): number {
  const match = issueUrl.match(/\/issues\/(\d+)$/);
  if (!match) throw new Error(`Cannot extract issue number from: ${issueUrl}`);
  return parseInt(match[1]!, 10);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Truncate long text for embedding | Sliding window chunking with overlap | Project convention since Phase 85 | Better recall for long content |
| Fixed lookback window for sync | Stored timestamp cursor | CONTEXT.md decision | Precise, no missed updates |
| Per-issue comment fetch | Repo-wide comment list with `since` | Standard for bulk ops | 100x fewer API calls |

**Deprecated/outdated:**
- None for this phase -- all patterns are current.

## Open Questions

1. **Comment backfill strategy: bulk vs per-issue**
   - What we know: Repo-wide `GET /repos/{o}/{r}/issues/comments` is efficient for bulk comment fetch. Per-issue fetch is simpler but costs 1 call per issue.
   - What's unclear: For nightly sync, repo-wide with `since` is ideal. For initial backfill, repo-wide also works (it returns comments across all issues). But we need to associate each comment with its parent issue for the context prefix.
   - Recommendation: Use repo-wide for both backfill and sync. Extract issue number from `issue_url`. Cache issue titles in-memory (Map<number, string>) during backfill for the embedding prefix.

2. **Body trimming for embeddings**
   - What we know: Research note says "embed problem summary only (title + description section), not full body with logs/system info."
   - What's unclear: How to reliably detect the "description section" boundary. Issue templates vary; some have `### Description` headers, others are freeform.
   - Recommendation: Embed full title + body for now. If embedding quality is poor due to noise, add a trimming heuristic in a follow-up. The full body is stored in DB regardless.

3. **xbmc/xbmc issue scale verification**
   - What we know: GraphQL reports 4,898 issues (non-PR). At ~100 per page (mixed with PRs), ~280 pages of API calls.
   - What's unclear: Average comment count per issue (affects total embedding count and duration).
   - Recommendation: Implement progress logging that reports cumulative counts. Test on a smaller repo first (per `--repo` flag).

## Sources

### Primary (HIGH confidence)
- `src/knowledge/review-comment-backfill.ts` - Existing backfill pattern (pagination, sync state, rate limiting, embedding)
- `src/knowledge/wiki-sync.ts` - Existing sync pattern (incremental, timestamp-based)
- `src/knowledge/issue-store.ts` - IssueStore with upsert/upsertComment (Phase 105)
- `src/knowledge/issue-types.ts` - IssueInput, IssueCommentInput types (Phase 105)
- `src/db/migrations/014-issues.sql` - Schema with HNSW indexes (Phase 105)
- `src/knowledge/embeddings.ts` - EmbeddingProvider wrapper (fail-open, voyage-code-3)
- `scripts/backfill-review-comments.ts` - CLI script pattern (parseArgs, env validation, GitHub App bootstrap)
- GitHub REST API docs - Issues API parameters (`since`, `state`, `sort`, `per_page`)
- GitHub REST API docs - Issue comments API (repo-wide and per-issue endpoints)

### Secondary (MEDIUM confidence)
- GitHub API rate limits docs - Installation tokens get 5,000+ req/hr
- Voyage AI docs - voyage-code-3 basic tier: 2,000 RPM, 3M TPM
- xbmc/xbmc GitHub GraphQL - 4,898 issues total (queried 2026-02-26)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use; no new dependencies
- Architecture: HIGH - Direct clone of review-comment-backfill pattern with Issues API
- Pitfalls: HIGH - Verified against GitHub API docs and existing project patterns

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable domain -- GitHub API and Voyage AI are well-established)

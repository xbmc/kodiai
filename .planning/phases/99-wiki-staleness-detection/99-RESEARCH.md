# Phase 99: Wiki Staleness Detection - Research

**Researched:** 2026-02-25
**Domain:** Scheduled staleness detection, GitHub commit diff analysis, Slack Block Kit reporting
**Confidence:** HIGH (codebase verified, patterns confirmed from existing infrastructure)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Evidence presentation:**
- Each stale page shows: commit SHA, changed file path, and a one-line summary of what changed
- Confidence tiers displayed per evidence item: High / Medium / Low — readers prioritize updates accordingly
- LLM evaluation produces the explanation (e.g., "API endpoint renamed from /users to /accounts but wiki still references /users")

**Report format & delivery:**
- Primary channel: Slack message to `#ai-wiki` (dedicated channel)
- Threaded layout: summary message in channel, each stale page gets its own thread reply with evidence
- Top 5 most stale pages prominent in summary; remaining flagged pages in thread replies
- No report posted when no staleness detected — skip silently
- Each stale page entry includes a direct link to the wiki page (Claude's discretion on format per channel)

**Heuristic vs LLM boundary:**
- Heuristic pass design at Claude's discretion (file path matching, keyword overlap, etc.)
- When more than 20 pages flagged, prioritize by recency — most recently affected commits evaluated first
- Pages flagged but not LLM-evaluated due to cap are deferred to next cycle (not shown in report)
- LLM evaluation explains WHY a page is stale, not just confirm/deny — this explanation becomes the one-line summary in the report

**Scheduling & triggers:**
- Weekly scheduled run (default)
- On-demand trigger via `@kodiai wiki-check` mention (not slash command)
- Scan window: commits since last successful run (no duplicates, no gaps)
- On scan failure: post failure notification to `#ai-wiki` so team knows it didn't run

### Claude's Discretion
- Evidence grouping strategy (by wiki page vs by commit)
- Heuristic pass algorithm design
- Link formatting per delivery channel
- Exact Slack message block kit layout
- Staleness score calculation internals

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIKI-01 | Scheduled job compares wiki page content references against recent code changes to compute staleness scores | Weekly scheduler pattern mirrors `createWikiSyncScheduler`; `wiki_sync_state` table tracks last successful run timestamp |
| WIKI-02 | File-path-level evidence linking identifies specific code changes that invalidate wiki content with commit SHAs | GitHub Octokit `repos.listCommits` + `repos.getCommit` APIs provide changed file paths and SHAs; existing `GitHubApp.getInstallationOctokit()` provides authenticated access |
| WIKI-03 | Staleness report delivered on schedule (Slack message to `#ai-wiki`) listing top-N stale pages with evidence | Slack client needs `postStandaloneMessage` addition; threaded layout uses existing `postThreadMessage`; dedicated `SLACK_WIKI_CHANNEL_ID` env var needed |
| WIKI-04 | Staleness threshold configurable via `.kodiai.yml` `wiki.staleness_threshold_days` | `execution/config.ts` zod schema extended with new `wiki:` section; existing section-fallback parse pattern applies |
| WIKI-05 | Two-tier detection: cheap heuristic pass first, LLM evaluation only on flagged subset (capped at 20 pages/cycle) | `generateWithFallback()` + `TASK_TYPES.STALENESS_EVIDENCE` already defined; `staleness.evidence` task type already registered in `task-types.ts` |
</phase_requirements>

## Summary

Phase 99 implements a wiki staleness detection system that periodically scans recent code commits and identifies wiki pages whose content is likely invalidated by those changes. The system uses a two-tier approach: a cheap heuristic pass (file path and keyword overlap) to narrow candidates, followed by LLM evaluation (via the existing `generateWithFallback` + `staleness.evidence` task type) on up to 20 pages per cycle. Results are delivered as a threaded Slack report to a dedicated `#ai-wiki` channel.

The codebase already has all the major building blocks in place. The wiki pages corpus (`wiki_pages` table), sync state tracking (`wiki_sync_state`), GitHub App auth, LLM task routing, and Slack messaging primitives are all implemented. What's needed is: (1) a new staleness scanner module that queries GitHub commit history against wiki content, (2) a new `wiki:` config section in `.kodiai.yml`, (3) a new standalone Slack posting method on `SlackClient`, (4) a new weekly scheduler (parallel to `createWikiSyncScheduler`), and (5) a new migration for a `wiki_staleness_run_state` table to track scan window and avoid duplicates.

The critical research flag noted in `STATE.md` — "heuristic for mapping wiki prose to code file paths needs validation against actual Kodi wiki content" — is addressed in the architecture below. The heuristic design is at Claude's discretion; file path tokens extracted from wiki `chunk_text` cross-referenced against changed file paths in commits is the recommended approach.

**Primary recommendation:** Build `createWikiStalenessDetector` as a new module in `src/knowledge/`, following the same factory pattern as `createWikiSyncScheduler`, wired into `src/index.ts` alongside the existing wiki sync scheduler. The staleness run state belongs in a new DB table (`wiki_staleness_run_state`) rather than overloading `wiki_sync_state`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun built-in `setInterval` | runtime | Weekly scheduler timing | Already used in `wiki-sync.ts` for 24h interval |
| `@octokit/rest` (via `GitHubApp`) | existing | List commits and changed files from GitHub | Already wired; `getInstallationOctokit()` is the injection point |
| Vercel AI SDK `generateText()` | existing | LLM staleness evaluation | `generateWithFallback()` wrapper already handles fallback + cost tracking |
| `postgres` (`Sql` type) | existing | Store staleness run state | All other stores use this pattern |
| Slack API `chat.postMessage` | existing | Post to `#ai-wiki` channel | Need to add `postStandaloneMessage` method to `SlackClient` |
| `zod` | existing | `.kodiai.yml` wiki config schema | Matches existing section-fallback parse pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` Logger | existing | Structured logging | Injected as `Logger` to all modules |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `wiki_staleness_run_state` table | Reuse `wiki_sync_state` | Separate table avoids coupling staleness cadence to wiki sync; staleness scan has different window semantics |
| Env var `SLACK_WIKI_CHANNEL_ID` | Hardcode `#ai-wiki` lookup | Env var is consistent with `SLACK_KODIAI_CHANNEL_ID` pattern; channel ID (not name) is what Slack API needs |

**No new npm packages needed.** All dependencies are already in the project.

## Architecture Patterns

### Recommended Project Structure

New files:
```
src/knowledge/
├── wiki-staleness-detector.ts       # core staleness scanner + scheduler
├── wiki-staleness-detector.test.ts  # unit tests
└── wiki-staleness-types.ts          # type definitions

src/db/migrations/
└── 012-wiki-staleness-run-state.sql # new table for run tracking
```

Modified files:
```
src/slack/client.ts             # add postStandaloneMessage()
src/slack/client.test.ts        # test new method
src/execution/config.ts         # add wiki: zod schema section
src/index.ts                    # wire staleness detector + scheduler
```

### Pattern 1: Staleness Detector Factory (mirrors wiki-sync.ts)

**What:** `createWikiStalenessDetector(opts)` returns `{ runScan(), start(), stop() }`
**When to use:** All stateful scheduled scanners in this project use factory functions.
**Example:**
```typescript
// Mirrors createWikiSyncScheduler pattern from src/knowledge/wiki-sync.ts
export function createWikiStalenessDetector(opts: WikiStalenessDetectorOptions): WikiStalenessScheduler {
  return {
    async runScan(): Promise<WikiStalenessScanResult> { ... },
    start(): void {
      // 7-day interval, 90s startup delay to avoid startup race with wiki sync
      setTimeout(async () => {
        await this.runScan().catch(handleError);
        setInterval(() => this.runScan().catch(handleError), 7 * 24 * 60 * 60 * 1000);
      }, 90_000);
    },
    stop(): void { clearInterval(...); },
  };
}
```

### Pattern 2: Two-Tier Detection Pipeline

**What:** Heuristic pass narrows candidates; LLM confirms staleness and generates explanation.
**When to use:** Prevents unbounded LLM spend; heuristic is O(pages × commits), LLM is capped.

```typescript
// Step 1: collect changed files from commits since lastSuccessfulRun
const changedFiles = await fetchChangedFilesSinceRun(octokit, owner, repo, lastRun);

// Step 2: heuristic pass — score each wiki page against changed files
const candidates = await heuristicPass(wikiPageStore, changedFiles);
// candidates sorted by score descending

// Step 3: LLM evaluation — cap at 20, prioritize by recency of affecting commit
const toEvaluate = candidates.slice(0, 20);
const stalePages = await Promise.all(
  toEvaluate.map((c) => evaluateWithLlm(c, taskRouter, generateWithFallback))
);
```

### Pattern 3: Heuristic Scoring (Claude's Discretion)

Recommended heuristic — file path token overlap with wiki chunk text:
```typescript
function heuristicScore(wikiChunkText: string, changedFilePaths: string[]): number {
  // Extract path components: "src/api/users.ts" → ["src", "api", "users", "ts"]
  const chunkTokens = new Set(wikiChunkText.toLowerCase().split(/\W+/).filter(t => t.length > 3));
  let score = 0;
  for (const filePath of changedFilePaths) {
    const pathTokens = filePath.toLowerCase().split(/[/._-]+/).filter(t => t.length > 3);
    for (const token of pathTokens) {
      if (chunkTokens.has(token)) score++;
    }
  }
  return score;
}
```

Pages with score > 0 are flagged as candidates. Score also determines the "confidence tier":
- score >= 3: High
- score >= 1: Medium
- (anything lower is filtered out)

LLM evaluation upgrades or downgrades to Low based on semantic analysis.

### Pattern 4: Slack Threaded Report

**What:** Summary message in channel, thread replies per stale page.
**Existing:** `SlackClient.postThreadMessage()` handles thread replies. Need new `postStandaloneMessage()` for the summary.

```typescript
// New method on SlackClient (src/slack/client.ts)
async postStandaloneMessage(input: { channel: string; text: string }): Promise<{ ts: string }> {
  const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { authorization: `Bearer ${input.botToken}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: input.channel, text: input.text }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Returns { ts } for threading
}
```

**Report format:**
```
Summary message (channel):
  "Wiki Staleness Report — 3 pages may be outdated (2026-02-25)"
  "Top stale pages: ..."

Thread reply per stale page:
  "[High] <wiki-url|PageTitle>
   Changed: src/api/users.ts (abc1234) — API endpoint renamed from /users to /accounts but wiki still references /users"
```

### Pattern 5: `@kodiai wiki-check` Trigger

**What:** The existing Slack event pipeline (safety rails → `onAllowedBootstrap`) already routes any mention of `@kodiai` to the assistant handler. The wiki-check trigger needs to be intercepted BEFORE the assistant handler dispatches to the Claude agent.

**How:** In `src/index.ts`, the `onAllowedBootstrap` callback receives the message. Add pre-dispatch text matching for `wiki-check` (case-insensitive) and route to `wikiStalenessDetector.runScan()` directly, skipping the LLM agent path.

```typescript
// In onAllowedBootstrap callback (index.ts):
if (/wiki[-\s]?check/i.test(addressed.text)) {
  // Fire-and-forget: run staleness scan immediately
  wikiStalenessDetector?.runScan().catch((err) =>
    logger.error({ err }, "On-demand wiki-check scan failed")
  );
  return; // Don't route to slackAssistantHandler
}
```

This keeps the trigger lean — no agent invocation for a predetermined action.

### Pattern 6: DB Migration (012)

**New table: `wiki_staleness_run_state`**

```sql
CREATE TABLE wiki_staleness_run_state (
  id            SERIAL PRIMARY KEY,
  last_run_at   TIMESTAMPTZ,          -- timestamp of last successful scan completion
  last_commit_sha TEXT,               -- SHA of newest commit scanned (scan window anchor)
  pages_flagged INTEGER NOT NULL DEFAULT 0,
  pages_evaluated INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'success' | 'failed' | 'pending'
  error_message TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Single row (no per-repo sharding needed — staleness is global for kodi.wiki)
```

The `last_commit_sha` field is the scan window anchor: next scan queries commits since this SHA (or since last_run_at if SHA is unavailable), eliminating duplicates and gaps.

### Pattern 7: Config Extension (`.kodiai.yml` `wiki:` section)

```typescript
// In src/execution/config.ts — new zod schema section:
const wikiSchema = z.object({
  staleness_threshold_days: z.number().min(1).max(365).default(30),
  enabled: z.boolean().default(true),
  channel: z.string().default(""),  // falls back to SLACK_WIKI_CHANNEL_ID env var
}).default({ staleness_threshold_days: 30, enabled: true, channel: "" });
```

The `staleness_threshold_days` controls the commit lookback window: only commits newer than this age are considered when evaluating staleness.

Note: `.kodiai.yml` is a per-REPO config, but the wiki staleness detector is global (Kodiai-side, not per-repo). Resolution: the config is read from the `SLACK_DEFAULT_REPO` (the primary monitored repo), or the wiki config lives in the app-level `config.ts` via env vars rather than `.kodiai.yml`. **Recommended approach:** use env vars for the global wiki config (`WIKI_STALENESS_THRESHOLD_DAYS`, `SLACK_WIKI_CHANNEL_ID`) following the existing `config.ts` pattern, since wiki staleness is not repo-specific.

### Anti-Patterns to Avoid

- **Do not use the Claude Agent SDK for staleness evaluation.** `staleness.evidence` is `non-agentic` in `task-types.ts` — use `generateWithFallback()` with `sdk: "ai"`.
- **Do not post an empty report.** Decision: skip silently if no staleness detected. Check stale pages count before posting.
- **Do not reuse `wiki_sync_state` for staleness run tracking.** Separate table avoids coupling.
- **Do not scan ALL wiki pages.** Only query `wiki_pages` WHERE `deleted = false` AND `stale = false`.
- **Do not LLM-evaluate more than 20 pages.** The 20-page cap is a hard constraint from the requirements.
- **Do not include deferred pages in the report.** Pages beyond the cap are silently deferred to next cycle.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM call with fallback | Custom retry logic | `generateWithFallback()` in `src/llm/generate.ts` | Already handles 429/5xx fallback, cost tracking, logging |
| Task routing to model | Direct model config | `createTaskRouter()` + `TASK_TYPES.STALENESS_EVIDENCE` | Already defined; maps to Haiku-tier model by default |
| Slack message posting | Raw fetch calls | Extend `SlackClient` | Error handling, auth, timeout already implemented |
| YAML config parsing | Manual YAML | `zod` + section-fallback pattern in `execution/config.ts` | Consistent with all other config sections |
| DB operations | Raw SQL | Follow `wiki-store.ts` factory pattern | Consistent dependency injection |
| Commit pagination | Manual page cursor | Octokit's built-in pagination (`octokit.paginate`) | Handles `Link` header, rate limits |

**Key insight:** Everything in this phase wires together existing infrastructure. No new abstractions needed — just new modules following established patterns.

## Common Pitfalls

### Pitfall 1: Wiki Config vs. App Config Scope
**What goes wrong:** Adding `wiki:` to the repo `.kodiai.yml` schema but wiki staleness is a global Kodiai concern, not per-repo. The detector runs once for all kodi.wiki pages, not per-repo.
**Why it happens:** Phase requirement says "configurable via `.kodiai.yml` `wiki.staleness_threshold_days`" but the wiki sync is already configured globally (via `source: "kodi.wiki"` in index.ts).
**How to avoid:** Add `wiki` config to app-level `config.ts` (env var `WIKI_STALENESS_THRESHOLD_DAYS`) rather than to the repo-level `.kodiai.yml` schema. The requirement intent is configurability — env var achieves this without per-repo config complexity.
**Warning signs:** If you find yourself passing `RepoConfig` into the staleness detector, you've gone wrong.

### Pitfall 2: GitHub API Rate Limits on Commit Listing
**What goes wrong:** Listing all commits since last run can hit rate limits if the window is large (e.g., first run after a week of inactivity).
**Why it happens:** GitHub API allows 5000 req/hour per installation. Listing commits and fetching individual commit diffs separately is 2× the requests.
**How to avoid:** Use `octokit.repos.listCommits` with `since` param (returns commit metadata + file list). Use `per_page: 100` and paginate. Cap the commit scan window at 7 days even if last run was older.
**Warning signs:** HTTP 403 or `X-RateLimit-Remaining: 0` in logs.

### Pitfall 3: `wiki_pages` Table vs. Distinct Pages
**What goes wrong:** `wiki_pages` stores CHUNKS (multiple rows per page). Heuristic pass must operate on pages (grouped by `page_id`), not chunks individually.
**Why it happens:** The chunk-level schema means a single wiki page may have 10+ rows. Evaluating each chunk separately inflates the LLM 20-page cap.
**How to avoid:** Group chunks by `page_id` for the heuristic pass. Use `SELECT DISTINCT page_id, page_title, page_url` or aggregate chunks per page before scoring.
**Warning signs:** Seeing the same page title 5+ times in staleness candidates.

### Pitfall 4: Slack `ts` Field for Threading
**What goes wrong:** Thread replies require the `ts` of the parent message. If `postStandaloneMessage` doesn't return `ts`, threading fails.
**Why it happens:** `chat.postMessage` returns `ts` in the JSON response body, but `postThreadMessage` only posts (doesn't return anything). Need to capture `ts` from the standalone summary message.
**How to avoid:** `postStandaloneMessage` must return `Promise<{ ts: string }>` — parse `message.ts` from the Slack API response.
**Warning signs:** Thread replies appear as top-level messages.

### Pitfall 5: On-Demand Trigger Blocking Shutdown
**What goes wrong:** `@kodiai wiki-check` fires `runScan()` fire-and-forget, but if shutdown begins during the scan, the `requestTracker` doesn't know about it.
**Why it happens:** The on-demand path bypasses the `requestTracker.trackJob()` pattern used by webhook handlers.
**How to avoid:** Wrap the on-demand `runScan()` call with `requestTracker.trackJob()` (same pattern as Slack event handlers in `routes/slack-events.ts` line 164).

### Pitfall 6: Empty Wiki Store on First Run
**What goes wrong:** Staleness detection runs before wiki backfill completes — no wiki pages in DB, scan returns 0 candidates, looks like success but is actually empty.
**Why it happens:** Wiki backfill takes hours on first deploy.
**How to avoid:** Check `wikiPageStore.countBySource()` before running; skip and log if count is 0. Do not post a report.

## Code Examples

Verified patterns from existing codebase:

### LLM call via generateWithFallback
```typescript
// Source: src/llm/generate.ts + task-types.ts
import { generateWithFallback } from "../llm/generate.ts";
import { TASK_TYPES } from "../llm/task-types.ts";

const resolved = taskRouter.resolve(TASK_TYPES.STALENESS_EVIDENCE);
const result = await generateWithFallback({
  taskType: TASK_TYPES.STALENESS_EVIDENCE,
  resolved,
  system: "You are a wiki staleness evaluator...",
  prompt: `Wiki page: ${pageTitle}\nContent: ${chunkText}\n\nChanged files:\n${changedFiles.join("\n")}\n\nIs this wiki page stale? If yes, explain in one sentence why.`,
  logger,
});
// result.text contains the one-line explanation
```

### Wiki page query (distinct pages)
```typescript
// Source: src/knowledge/wiki-store.ts pattern
const rows = await sql`
  SELECT DISTINCT ON (page_id) page_id, page_title, page_url, chunk_text
  FROM wiki_pages
  WHERE deleted = false AND stale = false
  ORDER BY page_id, chunk_index
`;
```

### Slack threaded report
```typescript
// Source: src/slack/client.ts (postThreadMessage pattern)
// 1. Post summary (new method):
const { ts: summaryTs } = await slackClient.postStandaloneMessage({
  channel: wikiChannelId,
  text: `Wiki Staleness Report — ${stalePages.length} pages may be outdated`,
});

// 2. Post one thread reply per stale page:
for (const page of stalePages) {
  await slackClient.postThreadMessage({
    channel: wikiChannelId,
    threadTs: summaryTs,
    text: `[${page.confidence}] <${page.url}|${page.title}>\n${page.evidence}`,
  });
}
```

### Weekly scheduler (mirrors wiki-sync.ts)
```typescript
// Source: src/knowledge/wiki-sync.ts createWikiSyncScheduler pattern
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 90_000; // avoid startup race with wiki sync (60s)

export function createWikiStalenessDetector(opts: WikiStalenessDetectorOptions) {
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      setTimeout(async () => {
        await this.runScan().catch((err) => opts.logger.error({ err }, "Initial staleness scan failed"));
        intervalHandle = setInterval(() => {
          this.runScan().catch((err) => opts.logger.error({ err }, "Scheduled staleness scan failed"));
        }, WEEKLY_INTERVAL_MS);
      }, STARTUP_DELAY_MS);
    },
    stop() {
      if (intervalHandle) clearInterval(intervalHandle);
    },
  };
}
```

### GitHub commit listing with Octokit
```typescript
// Source: src/auth/github-app.ts (getInstallationOctokit pattern)
const octokit = await githubApp.getInstallationOctokit(installationId);
const commits = await octokit.paginate(octokit.repos.listCommits, {
  owner,
  repo,
  since: lastRunAt.toISOString(),  // ISO 8601
  per_page: 100,
});
// Each commit has: commit.sha, commit.files[].filename, commit.files[].status
// Note: listCommits returns abbreviated info; use getCommit for file list
const detail = await octokit.repos.getCommit({ owner, repo, ref: sha });
// detail.data.files[].filename — full file paths
```

### App config extension for wiki
```typescript
// Source: src/config.ts pattern (new fields to add)
const configSchema = z.object({
  // ... existing fields ...
  slackWikiChannelId: z.string().default(""),  // SLACK_WIKI_CHANNEL_ID env var
  wikiStalenessThresholdDays: z.coerce.number().min(1).max(365).default(30),
  wikiOwner: z.string().default("xbmc"),   // GitHub owner for commit scanning
  wikiRepo: z.string().default("xbmc"),    // GitHub repo for commit scanning
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agent SDK for all LLM tasks | Vercel AI SDK `generateText()` for non-agentic | Phase 97 | Staleness evaluation uses AI SDK, not Agent SDK |
| Per-page LLM scan (unbounded cost) | Two-tier: heuristic + capped LLM | Phase 99 decision | Max 20 LLM calls per weekly cycle |
| Slack single-message responses | Threaded layout (summary + thread replies) | Phase 99 decision | Keeps `#ai-wiki` scannable |

**Deprecated/outdated:**
- `streamText()`: not used anywhere due to Bun production build failure (oven-sh/bun#25630) — use `generateText()` exclusively.

## Open Questions

1. **Which GitHub repo to scan for commits?**
   - What we know: The wiki staleness detector needs a GitHub repo to query commits from. The Kodi project is `xbmc/xbmc`. The app is installed for one repo (`slackDefaultRepo: "xbmc/xbmc"`).
   - What's unclear: Is there a single "canonical" repo to scan, or should it be configurable?
   - Recommendation: Default to `SLACK_DEFAULT_REPO` env var (`xbmc/xbmc`) for the commit scan. Add `WIKI_GITHUB_REPO` env var override if needed.

2. **Installation ID for GitHub API calls**
   - What we know: `githubApp.getInstallationOctokit(installationId)` needs an installation ID. The wiki sync doesn't use GitHub API (it uses MediaWiki). No existing installation ID lookup for a general repo scan.
   - What's unclear: How to get the installation ID at startup for the default repo.
   - Recommendation: Call `githubApp.getRepoInstallationContext(owner, repo)` once at startup and cache the installation ID in the staleness detector's options. This mirrors how `slackInstallationCache` works in `index.ts`.

3. **LLM prompt for staleness evaluation**
   - What we know: Must produce a one-line explanation as the output. `STALENESS_EVIDENCE` task type routes to Haiku-tier model by default (non-agentic).
   - What's unclear: Whether to pass full wiki page content or just the matching chunk.
   - Recommendation: Pass the matching chunks (the ones that scored highest in heuristic pass), not the full page, to stay within context limits. Max 2-3 chunks per page evaluation.

## Validation Architecture

> Skipped — `workflow.nyquist_validation` is not configured (treated as false).

## Sources

### Primary (HIGH confidence)
- `/home/keith/src/kodiai/src/knowledge/wiki-sync.ts` — scheduler pattern, `WikiSyncResult`, interval structure
- `/home/keith/src/kodiai/src/knowledge/wiki-store.ts` — `WikiPageStore` interface, `wiki_pages` table structure, factory pattern
- `/home/keith/src/kodiai/src/knowledge/wiki-types.ts` — `WikiPageRecord`, `WikiSyncState` types
- `/home/keith/src/kodiai/src/llm/task-types.ts` — `STALENESS_EVIDENCE` already defined as non-agentic
- `/home/keith/src/kodiai/src/llm/generate.ts` — `generateWithFallback()` usage pattern
- `/home/keith/src/kodiai/src/llm/task-router.ts` — `createTaskRouter()`, `ResolvedModel`
- `/home/keith/src/kodiai/src/slack/client.ts` — `SlackClient` interface, `postThreadMessage` pattern
- `/home/keith/src/kodiai/src/slack/safety-rails.ts` — `@kodiai` mention detection: `/@kodiai/i` regex pattern
- `/home/keith/src/kodiai/src/execution/config.ts` — `zod` schema + section-fallback parser for `.kodiai.yml`
- `/home/keith/src/kodiai/src/config.ts` — app-level config pattern with env var fields
- `/home/keith/src/kodiai/src/index.ts` — wiki sync wiring, `onAllowedBootstrap` pattern, `requestTracker.trackJob()`
- `/home/keith/src/kodiai/src/db/migrations/011-contributor-profiles.sql` — migration 011 is latest; next is 012

### Secondary (MEDIUM confidence)
- `STATE.md` research flag: "heuristic for mapping wiki prose to code file paths needs validation" — confirmed as known risk, addressed with token-overlap approach

### Tertiary (LOW confidence)
- Octokit `repos.listCommits` + `repos.getCommit` for file-level diff: based on @octokit/rest API knowledge; should be validated against actual GitHub API response shape before implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use in codebase
- Architecture: HIGH — all patterns mirror verified existing code
- Pitfalls: HIGH — derived from reading actual codebase, not theoretical
- GitHub API details: MEDIUM — Octokit patterns inferred from usage, not directly verified in this codebase

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (30 days; stable infrastructure, no fast-moving dependencies)

# Phase 114: Reaction Tracking - Research

**Researched:** 2026-03-01
**Domain:** GitHub Reactions API, PostgreSQL migrations, cron scripts, threshold learning integration
**Confidence:** HIGH

## Summary

Phase 114 syncs thumbs up/down reactions on triage comments via a nightly GitHub Actions cron job and feeds them into the Bayesian threshold learning system as a secondary signal. The codebase already has all the patterns needed: standalone cron scripts (`scripts/backfill-issues.ts`), GitHub Actions workflows (`nightly-issue-sync.yml`), reaction filtering helpers (`feedback-sync.ts`), the `recordObservation` function in `threshold-learner.ts`, and the `comment_github_id` column on `issue_triage_state` (added in Phase 112).

**Primary recommendation:** One plan covering migration, sync script, workflow, and threshold integration. Small scope — one new table, one new script, one new workflow.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REACT-02 | Periodic sync job polls thumbs up/down reactions on recent triage comments | Standalone script pattern from `backfill-issues.ts`, cron from `nightly-issue-sync.yml`, `listForIssueComment` API |
| REACT-03 | Reaction data feeds into outcome feedback as secondary signal | `recordObservation()` from `threshold-learner.ts`, same update rule as issue-closed handler |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres (postgres.js) | latest | Tagged-template SQL queries | Already used project-wide via `createDbClient` |
| @octokit/rest | latest | GitHub Reactions API | Already used in all handlers via `githubApp.getInstallationOctokit()` |
| pino | latest | Structured logging | Already used in all scripts |

No new dependencies needed.

## Architecture Patterns

### Recommended File Structure
```
scripts/
  sync-triage-reactions.ts      # NEW: standalone nightly sync script
src/
  db/migrations/
    019-triage-comment-reactions.sql       # NEW: reactions table
    019-triage-comment-reactions.down.sql   # NEW: rollback
.github/workflows/
  nightly-reaction-sync.yml     # NEW: cron workflow
```

### Pattern 1: Standalone Script (from backfill-issues.ts)
```typescript
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { createGitHubApp } from "../src/auth/github-app.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
// ... parseArgs, createDbClient, runMigrations, createGitHubApp, initialize, process
```

### Pattern 2: GitHub Actions Nightly Cron (from nightly-issue-sync.yml)
```yaml
name: nightly-reaction-sync
on:
  schedule:
    - cron: '30 3 * * *'  # 3:30 AM UTC daily (offset from issue sync at 3:00)
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - name: Sync triage comment reactions
        run: bun scripts/sync-triage-reactions.ts
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          GITHUB_APP_ID: ${{ secrets.GITHUB_APP_ID }}
          GITHUB_PRIVATE_KEY: ${{ secrets.GITHUB_PRIVATE_KEY }}
```

### Pattern 3: Reaction Filtering (from feedback-sync.ts)
```typescript
// src/handlers/feedback-sync.ts:53-64
function isHumanThumbReaction(reaction: ReactionEntry, appSlug: string): boolean {
  if (reaction.content !== "+1" && reaction.content !== "-1") return false;
  const userType = (reaction.user?.type ?? "").toLowerCase();
  if (userType === "bot") return false;
  const reactorLogin = normalizeLogin(reaction.user?.login);
  if (reactorLogin.length === 0) return false;
  if (reactorLogin === normalizeLogin(appSlug)) return false;
  return true;
}
```

### Pattern 4: recordObservation for Secondary Signal (from threshold-learner.ts)
```typescript
// After syncing reactions, if thumbs_down > 0 and triage predicted duplicate:
await recordObservation({
  sql, repo,
  kodiaiPredictedDuplicate: true,   // triage comment existed with duplicates
  confirmedDuplicate: false,         // thumbs_down = users disagree with duplicate prediction
  logger,
});
```

## Key Design Decisions

### Reaction → Observation Mapping

Triage comments are posted when duplicates are found, so `kodiaiPredictedDuplicate` is always `true` for any comment with a `comment_github_id`. The reaction signal maps to `confirmedDuplicate`:

| Reaction State | Interpretation | Observation |
|---|---|---|
| thumbs_up > thumbs_down | Users agree with duplicate prediction | TP: kodiaiPredicted=true, confirmed=true |
| thumbs_down > thumbs_up | Users disagree with duplicate prediction | FP: kodiaiPredicted=true, confirmed=false |
| thumbs_up == thumbs_down | Ambiguous, skip | No observation recorded |
| No reactions | No signal | No observation recorded |

**Important:** Only record an observation when reactions have changed since last sync (compare with stored counts). This prevents re-recording the same signal on every nightly run.

### Dedup with Issue-Closed Handler

The issue-closed handler already records an observation when an issue is closed. Reaction tracking provides a **supplementary** signal for issues that are still open or where the closure didn't clearly indicate duplicate status. To avoid double-counting:

- If an `issue_outcome_feedback` record already exists for this issue, skip the reaction-based observation (closure signal takes precedence).
- Only record reaction-based observations for issues WITHOUT an outcome record yet.

### Window and Rate Limits

- Query window: triage comments from the last 30 days (configurable via `--days` arg)
- GitHub API rate: `listForIssueComment` costs 1 API call per comment. At 30 days × ~5 triaged issues/day = ~150 API calls per run. Well within GitHub App rate limits (5000/hour).
- Batch by repo: group triage records by repo, get one octokit per repo installation.

## Existing Infrastructure

### comment_github_id (Phase 112, REACT-01)
- Column: `issue_triage_state.comment_github_id BIGINT` (nullable)
- Stored by: `src/handlers/issue-opened.ts` lines 216-225
- Old triage records have NULL (pre-Phase 112)

### issue_outcome_feedback (Phase 112)
- Table tracks closure outcomes linked to triage records
- Used to check if closure-based observation already exists (dedup secondary signal)

### triage_threshold_state (Phase 113)
- Table tracks Bayesian alpha/beta per repo
- `recordObservation()` atomically UPSERTs into this table

### GitHub App Authentication
```typescript
const githubApp = createGitHubApp({ logger });
await githubApp.initialize();
const ctx = await githubApp.getRepoInstallationContext(owner, repoName);
const octokit = await githubApp.getInstallationOctokit(ctx.installationId);
```

## Common Pitfalls

### Pitfall 1: Re-recording Same Reaction Signal
**What goes wrong:** Every nightly run records the same observation, inflating sample_count.
**How to avoid:** Store `thumbs_up` and `thumbs_down` counts in `triage_comment_reactions`. Only record a new observation when counts have changed AND net direction has changed.

### Pitfall 2: Double-Counting with Closure Signal
**What goes wrong:** Both issue-closed and reaction sync record observations for the same issue.
**How to avoid:** Skip reaction-based observations for issues that already have an `issue_outcome_feedback` record.

### Pitfall 3: NULL comment_github_id
**What goes wrong:** Pre-Phase 112 triage records have no comment ID.
**How to avoid:** WHERE clause filters `comment_github_id IS NOT NULL`.

### Pitfall 4: GitHub App Slug Unknown
**What goes wrong:** Can't filter out bot's own reactions without knowing the app slug.
**How to avoid:** The app slug is available from `githubApp.getAppSlug()` or hardcode "kodiai[bot]". In the `backfill-issues.ts` pattern, the app info is obtained after `initialize()`.

## Sources

### Primary (HIGH confidence)
- `src/triage/threshold-learner.ts` — recordObservation, getEffectiveThreshold
- `src/handlers/feedback-sync.ts` — isHumanThumbReaction, ReactionEntry type, reaction filtering
- `src/handlers/issue-opened.ts` — comment_github_id storage (lines 216-225)
- `src/handlers/issue-closed.ts` — outcome capture, recordObservation call
- `src/db/migrations/017-issue-outcome-feedback.sql` — outcome table schema
- `src/db/migrations/018-triage-threshold-state.sql` — threshold state schema
- `scripts/backfill-issues.ts` — standalone script pattern
- `.github/workflows/nightly-issue-sync.yml` — cron workflow pattern

### Secondary (MEDIUM confidence)
- `.planning/research/OUTCOME-LEARNING.md` — reaction tracking design (sections 3-4)
- GitHub REST API `reactions.listForIssueComment` — standard API

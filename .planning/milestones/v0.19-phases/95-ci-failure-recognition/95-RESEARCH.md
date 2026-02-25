# Phase 95: CI Failure Recognition - Research

**Researched:** 2026-02-25
**Domain:** GitHub Checks API, webhook event handling, CI failure classification
**Confidence:** HIGH

## Summary

Phase 95 adds deterministic CI failure triage to Kodiai. When CI checks complete on a PR, Kodiai compares check results between the PR head SHA and the base branch, classifying failures as "unrelated" (also fail on base), "flaky" (high historical failure rate), or "possibly PR-related" (default). The annotation appears as a section within the existing Kodiai review comment -- not a standalone comment.

The implementation is straightforward: a new `check_suite.completed` webhook handler fetches check runs via `octokit.rest.checks.listForRef()` for both the PR head and base branch SHAs, compares them by check name, and builds a collapsible markdown section. A new `ci_check_history` database table tracks per-check pass/fail for flakiness calculation. The handler updates the existing Kodiai comment (or creates a standalone CI comment if no review comment exists yet) using the same upsert pattern as `upsertReviewDetailsComment`.

**Primary recommendation:** Build a new `src/handlers/ci-failure.ts` handler registered on `check_suite.completed`, with a pure classification module in `src/lib/ci-failure-classifier.ts` and a flakiness store in `src/db/` backed by migration 008. Use `octokit.rest.checks.listForRef()` -- NOT the Actions API -- to capture external CI systems like Jenkins.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Summary line + expandable details per check (e.g., "3 of 5 failures appear unrelated to this PR" with collapsible per-check reasoning)
- Presented as a section within the existing Kodiai review comment, not a standalone comment
- Each check shows base-branch evidence ("Also fails on main@abc123") plus flakiness stats ("Failed 8 of last 20 runs")
- Each verdict carries a confidence indicator: High (exact base-branch match), Medium (flaky override pattern), Low (weaker signal)
- Exact check name match: if the same check name fails on the PR head and on the base branch, it's classified as unrelated
- Compare against the last N (3-5) commits on the base branch, not just the merge-base SHA -- catches intermittent failures
- If no base-branch check results exist to compare against, skip the CI annotation section entirely (no guessing)
- PR-only failures (pass on base, fail on PR) are classified as "possibly PR-related" by default
- Flaky override: if a PR-only failure has >30% failure rate in its flakiness history, it can be classified as unrelated with medium confidence
- Dedicated database table tracking check name, pass/fail per run, rolling window stats
- Rolling window of last 20 runs per check for flakiness calculation
- 30% failure rate threshold (6 of 20 runs) marks a check as "flaky"
- Build up data organically as Kodiai processes PRs -- no historical backfill on first run
- Cold start accepted: no flakiness signal for first few weeks until data accumulates
- Triggered on `check_suite` completed webhook event (may fire multiple times per PR if multiple CI systems)
- Update/append the CI section as results arrive from different check suites
- When a re-run passes, update the CI section to remove the resolved failure -- keep the section accurate with current state
- No CI section when all checks pass (no noise on clean PRs)
- On new push to PR (new SHA), clear previous CI analysis and re-analyze when new checks complete
- Does not lower merge confidence or block approval based on failures classified as unrelated

### Claude's Discretion
- Exact number of base-branch commits to check (3-5 range)
- Expandable details formatting (HTML details/summary vs other approach)
- How to handle check suites that are still pending when analysis runs
- Rate limiting / debouncing of multiple check_suite events

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CIFR-01 | Kodiai fetches CI check results for the PR head SHA using the Checks API | `octokit.rest.checks.listForRef()` with head SHA; returns `check_runs[]` with name, status, conclusion |
| CIFR-02 | Kodiai compares CI check results against the base branch SHA to identify failures also present on base | Same `listForRef()` called for last N base-branch commits; match by `check_run.name` |
| CIFR-03 | Kodiai posts an annotation comment identifying which failures appear unrelated to the PR with reasoning | Section embedded in existing Kodiai comment via `upsertReviewDetailsComment` pattern; HTML `<details>` for expandable per-check detail |
| CIFR-04 | Kodiai does not block approval or lower merge confidence based on unrelated CI failures | CI failure handler is independent of review handler; merge confidence module (`merge-confidence.ts`) is not modified |
| CIFR-05 | Kodiai tracks historically flaky workflows/steps and uses flakiness history as a signal for unrelatedness | New `ci_check_history` table (migration 008); rolling window query for last 20 runs per check name+repo |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @octokit/rest | ^22.0.1 | GitHub Checks API (`checks.listForRef`) | Already in project; covers all needed endpoints |
| @octokit/webhooks-types | ^7.6.1 | `CheckSuiteCompletedEvent` type | Already in project; provides typed payload |
| postgres (via existing `sql`) | existing | Flakiness tracking table | Single DB connection pool already shared |
| zod | existing | Config/payload validation | Already used throughout |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | existing | Structured logging | Already wired into all handlers |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Checks API (`listForRef`) | Actions API (`listWorkflowRunsForRepo`) | Actions API misses Jenkins/external CI -- MUST use Checks API per requirements |
| Dedicated flakiness table | In-memory LRU cache | No persistence across restarts, no multi-instance support -- table is better |
| Separate CI comment | Section in existing review comment | User locked: section within existing comment |

**Installation:** No new packages needed. All dependencies are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── handlers/
│   └── ci-failure.ts              # check_suite.completed handler (orchestrator)
├── lib/
│   ├── ci-failure-classifier.ts   # Pure classification logic (testable)
│   └── ci-failure-formatter.ts    # Markdown section builder
├── db/
│   └── migrations/
│       ├── 008-ci-check-history.sql
│       └── 008-ci-check-history.down.sql
```

### Pattern 1: Handler Registration (existing project pattern)
**What:** New handler follows `createXxxHandler({ eventRouter, ... })` factory pattern
**When to use:** Every webhook event handler in the project
**Example:**
```typescript
// Source: existing pattern in src/handlers/dep-bump-merge-history.ts
export function createCIFailureHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  githubApp: GitHubApp;
  sql: Sql;
  logger: Logger;
}): void {
  const { eventRouter, jobQueue, githubApp, sql, logger } = deps;

  async function handleCheckSuiteCompleted(event: WebhookEvent): Promise<void> {
    // Extract PR info from check_suite.pull_requests[]
    // Fetch checks for head SHA and base branch
    // Classify and post annotation
  }

  eventRouter.register("check_suite.completed", handleCheckSuiteCompleted);
}
```

### Pattern 2: Checks API Fetch (new for this phase)
**What:** Fetch all completed check runs for a given ref using pagination
**When to use:** Comparing head vs base branch check results
**Example:**
```typescript
// Source: GitHub REST API docs -- https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference
async function fetchCheckRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<Array<{ name: string; conclusion: string | null; status: string }>> {
  const runs: Array<{ name: string; conclusion: string | null; status: string }> = [];
  for await (const response of octokit.paginate.iterator(
    octokit.rest.checks.listForRef,
    { owner, repo, ref, per_page: 100, filter: "latest" },
  )) {
    for (const run of response.data) {
      runs.push({ name: run.name, conclusion: run.conclusion, status: run.status });
    }
  }
  return runs;
}
```

### Pattern 3: Comment Section Upsert (existing project pattern)
**What:** Find existing Kodiai comment by marker, update with CI section, or create new
**When to use:** Posting/updating CI annotation within existing review comment
**Example:**
```typescript
// Source: existing pattern in src/handlers/review.ts (upsertReviewDetailsComment)
// 1. List PR comments, find one with Kodiai marker
// 2. If found: parse body, insert/replace CI section, updateComment
// 3. If not found: create standalone CI comment with marker
// Marker format: <!-- kodiai:ci-analysis:{owner}/{repo}/pr-{number}/head-{sha} -->
```

### Pattern 4: Flakiness Store (new for this phase)
**What:** Database table recording check pass/fail per run, queried for rolling window stats
**When to use:** Every check_suite.completed event records data; classification queries it
**Example:**
```sql
-- Migration 008
CREATE TABLE IF NOT EXISTS ci_check_history (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  repo TEXT NOT NULL,
  check_name TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  conclusion TEXT NOT NULL,         -- 'success', 'failure', 'neutral', etc.
  check_suite_id BIGINT,
  pr_number INTEGER                 -- NULL for non-PR runs
);

CREATE INDEX idx_ci_check_history_repo_name
  ON ci_check_history(repo, check_name, created_at DESC);
```

### Anti-Patterns to Avoid
- **Using Actions API instead of Checks API:** Actions API (`listWorkflowRunsForRepo`) only sees GitHub Actions workflows. External CI (Jenkins, CircleCI, TeamCity) uses the Checks API. This is explicitly called out in STATE.md critical pitfalls.
- **Blocking on incomplete check suites:** `check_suite.completed` fires per suite. If other suites are still pending, analyze what's available and update when more arrive. Never wait/poll for all suites to finish.
- **Modifying merge confidence:** CIFR-04 explicitly prohibits lowering merge confidence or blocking approval based on unrelated failures. The CI handler must be completely independent of the merge confidence path in `merge-confidence.ts`.
- **Guessing without base-branch data:** If `listForRef` returns no results for base branch commits, skip the CI annotation entirely. No heuristic guessing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Paginated API fetching | Manual page loop | `octokit.paginate.iterator()` | Handles Link headers, rate limits |
| Comment marker matching | Regex on comment bodies | Existing `<!-- kodiai:... -->` marker pattern | Proven pattern in review-idempotency.ts |
| Webhook event dispatch | Custom routing logic | Existing `eventRouter.register()` | Consistent with all other handlers |
| Rolling window stats | In-memory aggregation | SQL `ORDER BY created_at DESC LIMIT 20` query | Persistent, works across restarts |

**Key insight:** The project already has all infrastructure for webhook handling, comment upserts, and database operations. This phase only adds a new handler, a new classification module, and a new database table. No infrastructure work needed.

## Common Pitfalls

### Pitfall 1: Multiple check_suite.completed events per push
**What goes wrong:** A single push can trigger N check suites (e.g., GitHub Actions suite + Jenkins suite). Each fires `check_suite.completed` independently. Without debouncing, the handler runs N times, potentially clobbering earlier CI section updates.
**Why it happens:** Different CI systems create separate check suites.
**How to avoid:** The handler should always re-fetch ALL check runs for the head SHA (not just the suite that triggered), then rebuild the entire CI section. This makes each invocation idempotent -- the latest invocation always produces the correct state.
**Warning signs:** CI section shows incomplete data (missing checks from other suites).

### Pitfall 2: check_suite.pull_requests array empty for forks
**What goes wrong:** GitHub documents that `pull_requests` is empty for forked repos. The handler cannot link the check suite to a PR.
**Why it happens:** Security restriction -- GitHub doesn't expose fork PRs in check suite payloads.
**How to avoid:** When `pull_requests` is empty, skip processing. Log at debug level (not warn) since this is expected for forks.
**Warning signs:** Handler errors on missing PR data for fork PRs.

### Pitfall 3: Base branch has no check history
**What goes wrong:** New repos or repos where Kodiai was just installed have no base branch check data. Classification cannot determine if failures are pre-existing.
**Why it happens:** Cold start -- no data accumulated yet.
**How to avoid:** Per user decision: skip the CI annotation section entirely when no base-branch check results exist. The flakiness table also starts empty and accumulates organically.
**Warning signs:** CI annotation showing "0 of N failures unrelated" when it should show nothing.

### Pitfall 4: Stale CI section after force-push
**What goes wrong:** User force-pushes new commits, but the old CI section (for previous SHA) remains visible until new checks complete.
**Why it happens:** Force-push creates a new head SHA but check suites take time to run.
**How to avoid:** Per user decision: on new push to PR (detected via `pull_request.synchronize` or when head_sha changes), clear/remove the CI section. Re-analyze when new checks complete.
**Warning signs:** CI section references an old SHA that no longer matches PR head.

### Pitfall 5: checks:read permission not configured
**What goes wrong:** `octokit.rest.checks.listForRef()` returns 403 or empty results because the GitHub App lacks `checks:read` permission.
**Why it happens:** Permission not in the App manifest.
**How to avoid:** STATE.md already flags this: "`checks:read` GitHub App permission needs verification before Phase 95 -- may require App manifest update". Verify permission exists before implementation; if missing, add it to the manifest.
**Warning signs:** 403 errors or empty `check_runs` arrays in logs.

### Pitfall 6: Rate limiting from parallel base-branch fetches
**What goes wrong:** Fetching check runs for 5 base-branch commits means 5+ API calls per check_suite event. High-traffic repos could hit GitHub API rate limits.
**Why it happens:** Each base-branch commit requires a separate `listForRef` call.
**How to avoid:** Fetch base commits sequentially (not parallel) to reduce burst. Use 3 commits as default (lower end of 3-5 range). Cache base-branch results briefly since multiple check_suite events for the same PR will query the same base commits.
**Warning signs:** 429 responses from GitHub API in handler logs.

## Code Examples

### Extracting PR info from check_suite webhook
```typescript
// Source: @octokit/webhooks-types CheckSuiteCompletedEvent
import type { CheckSuiteCompletedEvent } from "@octokit/webhooks-types";

const payload = event.payload as unknown as CheckSuiteCompletedEvent;
const headSha = payload.check_suite.head_sha;
const pullRequests = payload.check_suite.pull_requests; // CheckRunPullRequest[]
const owner = payload.repository.owner.login;
const repo = payload.repository.name;

// Each PR in pull_requests has: number, head.sha, head.ref, base.sha, base.ref
for (const pr of pullRequests) {
  const prNumber = pr.number;
  const baseSha = pr.base.sha;
  const baseRef = pr.base.ref; // e.g., "main"
  // Process CI analysis for this PR
}
```

### Fetching last N base-branch commits
```typescript
// Source: Octokit REST API
async function getRecentBaseCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseRef: string,
  count: number,
): Promise<string[]> {
  const { data: commits } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    sha: baseRef,
    per_page: count,
  });
  return commits.map(c => c.sha);
}
```

### Classification logic (pure function)
```typescript
type CheckResult = { name: string; conclusion: string | null };
type Classification = "unrelated" | "flaky-unrelated" | "possibly-pr-related";
type Confidence = "high" | "medium" | "low";

type ClassifiedFailure = {
  checkName: string;
  classification: Classification;
  confidence: Confidence;
  evidence: string; // e.g., "Also fails on main@abc1234"
  flakiness?: { failRate: number; window: number };
};

function classifyFailures(
  headFailures: CheckResult[],
  baseResults: Map<string, CheckResult[]>, // keyed by commit SHA
  flakiness: Map<string, { failures: number; total: number }>,
): ClassifiedFailure[] {
  return headFailures
    .filter(r => r.conclusion === "failure")
    .map(failure => {
      // Check if same check name fails on any base commit
      for (const [sha, baseChecks] of baseResults) {
        const baseMatch = baseChecks.find(
          b => b.name === failure.name && b.conclusion === "failure"
        );
        if (baseMatch) {
          return {
            checkName: failure.name,
            classification: "unrelated" as const,
            confidence: "high" as const,
            evidence: `Also fails on ${sha.slice(0, 7)}`,
          };
        }
      }

      // Check flakiness override
      const stats = flakiness.get(failure.name);
      if (stats && stats.total >= 20 && stats.failures / stats.total > 0.3) {
        return {
          checkName: failure.name,
          classification: "flaky-unrelated" as const,
          confidence: "medium" as const,
          evidence: `Historically flaky`,
          flakiness: { failRate: stats.failures / stats.total, window: stats.total },
        };
      }

      return {
        checkName: failure.name,
        classification: "possibly-pr-related" as const,
        confidence: "low" as const,
        evidence: "Passes on base branch",
      };
    });
}
```

### CI section markdown formatting
```typescript
function formatCISection(
  classified: ClassifiedFailure[],
  totalFailures: number,
): string {
  const unrelated = classified.filter(
    c => c.classification === "unrelated" || c.classification === "flaky-unrelated"
  );

  const lines: string[] = [];
  lines.push(`### CI Failure Analysis`);
  lines.push(``);
  lines.push(`**${unrelated.length} of ${totalFailures} failures appear unrelated to this PR**`);
  lines.push(``);

  lines.push(`<details>`);
  lines.push(`<summary>Failure details</summary>`);
  lines.push(``);

  for (const item of classified) {
    const icon = item.classification === "unrelated" ? "white_check_mark"
      : item.classification === "flaky-unrelated" ? "warning"
      : "x";
    const conf = `[${item.confidence}]`;
    lines.push(`- :${icon}: **${item.checkName}** ${conf} -- ${item.evidence}`);
    if (item.flakiness) {
      lines.push(`  Failed ${Math.round(item.flakiness.failRate * 100)}% of last ${item.flakiness.window} runs`);
    }
  }

  lines.push(``);
  lines.push(`</details>`);

  return lines.join("\n");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Actions API for CI status | Checks API for CI status | Phase 95 (this phase) | External CI systems (Jenkins) now visible |
| No CI failure attribution | Deterministic base-branch comparison | Phase 95 (this phase) | Maintainers see which failures are pre-existing |
| Existing `ci-status-server.ts` uses Actions API | Phase 95 uses Checks API | Phase 95 | Two different approaches coexist; ci-status-server is an MCP tool for Claude, Phase 95 is deterministic |

**Deprecated/outdated:**
- `src/execution/mcp/ci-status-server.ts`: Uses Actions API (`listWorkflowRunsForRepo`). NOT suitable for Phase 95 (misses external CI). This MCP tool remains for Claude's interactive use but is NOT used for the deterministic CI annotation feature.

## Open Questions

1. **checks:read permission**
   - What we know: STATE.md flags this as a blocker: "checks:read GitHub App permission needs verification before Phase 95 -- may require App manifest update"
   - What's unclear: Whether the current GitHub App manifest already includes `checks:read`
   - Recommendation: First plan task should verify the App manifest and add permission if missing. Fail-open if permission is missing at runtime (log warning, skip CI annotation).

2. **Debouncing multiple check_suite events**
   - What we know: Multiple suites complete at different times for the same push. Each fires the handler.
   - What's unclear: Whether a simple "re-fetch all checks and rebuild" approach is sufficient, or if a debounce timer (e.g., wait 10s after first event) would reduce API calls.
   - Recommendation: Start with the idempotent re-fetch approach (no debounce). It's simpler and the API call count is bounded (1 call for head, 3-5 for base per invocation). Add debouncing only if rate limiting becomes an issue.

3. **Pending check suites during analysis**
   - What we know: When one suite completes, others may still be running.
   - What's unclear: Should the CI section mention "2 suites still pending" or just analyze what's completed?
   - Recommendation: Only analyze completed checks. Ignore pending ones. The section will be updated when the next suite completes.

4. **Comment update when no existing Kodiai review comment**
   - What we know: CI annotation should be "a section within the existing Kodiai review comment"
   - What's unclear: What happens when the check_suite completes before the Kodiai review comment is posted (race condition)
   - Recommendation: If no existing Kodiai comment is found, post a standalone CI annotation comment with a Kodiai CI marker. If a review comment appears later, the CI section stays separate. This avoids complex synchronization.

## Sources

### Primary (HIGH confidence)
- @octokit/webhooks-types v7.6.1 `CheckSuiteCompletedEvent` interface -- verified in `node_modules/@octokit/webhooks-types/schema.d.ts` line 1563
- @octokit/rest v22.0.1 `checks.listForRef()` method -- verified in [Octokit REST docs](https://octokit.github.io/rest.js/)
- GitHub REST API [Checks Runs endpoint](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference) -- response shape verified
- Existing project patterns: `src/handlers/review.ts` (comment upsert), `src/webhook/router.ts` (event registration), `src/handlers/dep-bump-merge-history.ts` (handler factory pattern)

### Secondary (MEDIUM confidence)
- GitHub [webhook events docs](https://docs.github.com/en/webhooks/webhook-events-and-payloads) -- `check_suite` payload structure
- `pull_requests` array empty for forked repos -- documented in GitHub API docs

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in the project, API verified
- Architecture: HIGH - follows established handler/router patterns exactly
- Pitfalls: HIGH - documented from GitHub API docs and existing project experience (STATE.md)

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable domain, GitHub API changes infrequently)

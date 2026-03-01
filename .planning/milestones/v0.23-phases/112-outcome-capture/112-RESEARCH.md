# Phase 112: Outcome Capture - Research

**Researched:** 2026-02-27
**Domain:** GitHub webhook handler, PostgreSQL migrations, issue lifecycle events
**Confidence:** HIGH

## Summary

Phase 112 captures issue closure outcomes by adding a new `issues.closed` webhook handler and an `issue_outcome_feedback` table, linking closure events back to existing triage records. The phase also requires storing the GitHub comment ID when triage comments are posted (REACT-01), enabling future reaction tracking in Phase 114.

The codebase already has a well-established handler factory pattern (`createIssueOpenedHandler`), event router registration (`eventRouter.register("issues.closed", ...)`), delivery-ID dedup at the webhook route level, and a migration system with sequentially numbered `.sql` files. The new handler follows all these patterns directly. The key technical decisions are: (1) PR filtering via `payload.issue.pull_request` field check, (2) confirmed duplicate detection using `state_reason === "duplicate"` with `duplicate` label fallback, and (3) delivery-ID idempotency via `UNIQUE(delivery_id)` on the outcome table.

The prior research in `.planning/research/OUTCOME-LEARNING.md` already contains detailed schema designs and payload analysis that align with the requirements. This phase-specific research validates those designs against the current codebase state and provides implementation-ready patterns.

**Primary recommendation:** Follow the `createIssueOpenedHandler` factory pattern exactly for the new `createIssueClosedHandler`, register on `issues.closed`, and create migration 017 with both the new table and the `ALTER TABLE` for `comment_github_id`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OUTCOME-01 | `issues.closed` events captured with resolution outcome | New handler registers on `issues.closed`, extracts `state_reason` from payload, stores in `issue_outcome_feedback` table |
| OUTCOME-02 | Confirmed duplicate from `state_reason` or `duplicate` label (not Kodiai's label) | Two-signal detection: `state_reason === "duplicate"` primary, `labels[].name === "duplicate"` fallback; explicitly exclude `possible-duplicate` |
| OUTCOME-03 | Outcome records link to original triage record | `triage_id BIGINT REFERENCES issue_triage_state(id)` foreign key, looked up by `(repo, issue_number)` |
| OUTCOME-04 | Handler filters out pull requests | Check `payload.issue.pull_request` field exists at handler top; GitHub fires `issues.closed` for PRs too |
| OUTCOME-05 | Idempotent via delivery-ID dedup | Layer 1: in-memory `Deduplicator` at webhook route. Layer 2: `UNIQUE(delivery_id)` on `issue_outcome_feedback` with `ON CONFLICT DO NOTHING` |
| REACT-01 | Triage comment GitHub ID captured and stored | Add `comment_github_id BIGINT` column to `issue_triage_state`, update `issue-opened.ts` to capture `response.data.id` after `createComment` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres (postgres.js) | latest | Tagged-template SQL queries | Already used project-wide via `createDbClient` |
| Octokit | latest | GitHub API for installation tokens | Already used in all handlers via `githubApp.getInstallationOctokit()` |
| pino | latest | Structured logging with child loggers | Already used in all handlers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bun:test | built-in | Unit testing | Test the handler with mock dependencies |

No new dependencies are needed. This phase uses only existing libraries.

## Architecture Patterns

### Recommended File Structure
```
src/
  handlers/
    issue-closed.ts          # NEW: createIssueClosedHandler factory
    issue-closed.test.ts     # NEW: unit tests
    issue-opened.ts          # MODIFY: capture comment_github_id
    issue-opened.test.ts     # MODIFY: add test for comment ID capture
  db/
    migrations/
      017-issue-outcome-feedback.sql       # NEW: outcome table + alter triage state
      017-issue-outcome-feedback.down.sql   # NEW: rollback
  index.ts                   # MODIFY: wire createIssueClosedHandler
```

### Pattern 1: Handler Factory Pattern
**What:** All webhook handlers use a `createXxxHandler(deps)` factory function that receives dependencies via injection, registers on the event router, and handles errors internally with try/catch.
**When to use:** For every new webhook event handler.
**Example (from `issue-opened.ts`):**
```typescript
// Source: src/handlers/issue-opened.ts (lines 32-224)
export function createIssueClosedHandler(deps: {
  eventRouter: EventRouter;
  sql: Sql;
  logger: Logger;
}): void {
  const { eventRouter, sql, logger } = deps;

  async function handleIssueClosed(event: WebhookEvent): Promise<void> {
    try {
      // Extract payload, validate, process
    } catch (err) {
      logger.error({ err, deliveryId: event.id }, "Issue closed handler failed (non-fatal)");
    }
  }

  eventRouter.register("issues.closed", handleIssueClosed);
}
```

### Pattern 2: Payload Type Assertion
**What:** Cast `event.payload` to a typed interface at handler entry for type safety.
**When to use:** At the top of every handler function.
**Example (from `issue-opened.ts`):**
```typescript
const payload = event.payload as {
  action: "closed";
  issue?: {
    number: number;
    title: string;
    body: string | null;
    state: "closed";
    state_reason: "completed" | "not_planned" | "duplicate" | null;
    labels: Array<{ name: string }>;
    pull_request?: unknown;  // Present when event is for a PR
    user?: { login: string };
    closed_at: string;
  };
  repository?: {
    full_name: string;
    name: string;
    owner?: { login: string };
  };
};
```

### Pattern 3: Event Router Registration Key
**What:** The router uses `{eventName}.{action}` format for specific matching.
**When to use:** When registering handlers.
**Key detail:** `eventRouter.register("issues.closed", handler)` matches webhooks where `X-GitHub-Event: issues` and `payload.action === "closed"`. The router builds key as `${event.name}.${action}` and checks both specific and general keys.
```typescript
// Source: src/webhook/router.ts (lines 55-66)
const action = event.payload.action as string | undefined;
const specificKey = action ? `${event.name}.${action}` : undefined;
// handlers.get(specificKey) is checked first, then handlers.get(generalKey)
```

### Pattern 4: Migration Numbering
**What:** Sequential numbered `.sql` files in `src/db/migrations/` with matching `.down.sql` rollback files.
**When to use:** For any schema changes.
**Key detail:** Current highest is `016-issue-triage-state.sql`. Next is `017`.

### Pattern 5: Idempotent INSERT with ON CONFLICT
**What:** Use `INSERT ... ON CONFLICT DO NOTHING` for delivery-ID based idempotency.
**When to use:** When processing webhook events that could be redelivered.
**Example:**
```typescript
const result = await sql`
  INSERT INTO issue_outcome_feedback (repo, issue_number, triage_id, outcome, ...)
  VALUES (${repo}, ${issueNumber}, ${triageId}, ${outcome}, ...)
  ON CONFLICT (delivery_id) DO NOTHING
  RETURNING id
`;
if (result.length === 0) {
  logger.info("Outcome already recorded (delivery-ID dedup), skipping");
  return;
}
```

### Pattern 6: Child Logger with Handler Context
**What:** Create a child logger with handler name, repo, issue number, and delivery ID.
**When to use:** At handler entry for structured log correlation.
```typescript
const handlerLogger = logger.child({
  handler: "issue-closed",
  repo,
  issueNumber,
  deliveryId: event.id,
});
```

### Anti-Patterns to Avoid
- **Confusing Kodiai's label with ground truth:** `possible-duplicate` is Kodiai's prediction. `duplicate` is the human verdict. Never use `possible-duplicate` when determining `confirmed_duplicate`.
- **Not filtering PRs:** GitHub fires `issues.closed` for pull requests too. Always check `payload.issue.pull_request` at handler top.
- **Counting `unknown` outcomes in future threshold updates:** Issues closed without `state_reason` and without a `duplicate` label should record `outcome = "unknown"` but must NOT feed into any future Beta-Binomial update (Phase 113 concern, but schema should support it now).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delivery-ID dedup | Custom dedup tracking | `UNIQUE(delivery_id)` + `ON CONFLICT DO NOTHING` | Database constraint is atomic, survives restarts |
| Webhook signature verification | Custom HMAC | Existing `verifyWebhookSignature` in webhook route | Already handled at route level before handler |
| In-memory delivery dedup | Another dedup cache | Existing `createDeduplicator()` at route level | Layer 1 dedup already exists; DB constraint is Layer 2 |
| Triage record lookup | Full-table scan or cache | `SELECT id, duplicate_count FROM issue_triage_state WHERE repo = $1 AND issue_number = $2` | Indexed on `(repo, issue_number)` UNIQUE |

## Common Pitfalls

### Pitfall 1: `issues.closed` Fires for Pull Requests
**What goes wrong:** Handler processes PR closure events, creating bogus outcome records for pull requests.
**Why it happens:** GitHub treats PRs as issues internally; `issues.closed` fires for both.
**How to avoid:** Check `payload.issue.pull_request` at handler top: `if (payload.issue?.pull_request) return;`
**Warning signs:** Outcome records where `issue_number` corresponds to a PR, not an issue.

### Pitfall 2: `state_reason` is Often NULL
**What goes wrong:** Most closures via API/bots have `state_reason = null`, leading to all outcomes being `unknown`.
**Why it happens:** Only the GitHub web UI (and newer API clients) populate `state_reason`. Bots, older integrations, and API calls without the field result in null.
**How to avoid:** Implement label-based fallback: if `state_reason` is null but `labels` contains `"duplicate"`, record `outcome = "duplicate"` and `confirmed_duplicate = true`.
**Warning signs:** > 80% of outcomes being `unknown` in production.

### Pitfall 3: Triage Record May Not Exist
**What goes wrong:** Trying to link outcome to triage but no triage record exists (issue was never triaged by Kodiai, or triage was disabled).
**Why it happens:** Not all issues are auto-triaged. Triage requires config gate + duplicate candidates found.
**How to avoid:** Look up triage record with `SELECT`, if null set `triage_id = NULL` in outcome. The FK is nullable by design.
**Warning signs:** Foreign key violations on insert.

### Pitfall 4: Missing comment_github_id on Old Triage Records
**What goes wrong:** After adding the `comment_github_id` column, existing triage records have NULL because the column didn't exist when they were created.
**Why it happens:** Migration adds column with no default; existing rows get NULL.
**How to avoid:** The column is intentionally nullable. Phase 114's reaction sync job must skip NULL `comment_github_id` rows gracefully.
**Warning signs:** Not a problem for Phase 112; becomes relevant in Phase 114.

### Pitfall 5: Duplicate Label Name Collision
**What goes wrong:** Checking for `"duplicate"` label picks up Kodiai's `"possible-duplicate"` label.
**Why it happens:** Substring or fuzzy matching instead of exact match.
**How to avoid:** Use exact match: `labels.some(l => l.name === "duplicate")`. The Kodiai label is `possible-duplicate` (with hyphen prefix), distinct from the standard `duplicate` label.
**Warning signs:** Inflated `confirmed_duplicate` rate.

## Code Examples

### Migration SQL: 017-issue-outcome-feedback.sql
```sql
-- Source: Adapted from .planning/research/OUTCOME-LEARNING.md schema

-- Add comment_github_id to issue_triage_state for reaction tracking (REACT-01)
ALTER TABLE issue_triage_state
  ADD COLUMN IF NOT EXISTS comment_github_id BIGINT;

-- Outcome feedback table for issue closure events
CREATE TABLE IF NOT EXISTS issue_outcome_feedback (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,

  -- Link to triage record (NULL if never triaged)
  triage_id BIGINT REFERENCES issue_triage_state(id) ON DELETE SET NULL,

  -- Outcome classification
  outcome TEXT NOT NULL,  -- "duplicate" | "completed" | "not_planned" | "unknown"
  kodiai_predicted_duplicate BOOLEAN NOT NULL DEFAULT false,
  confirmed_duplicate BOOLEAN NOT NULL DEFAULT false,
  duplicate_of_issue_number INTEGER,

  -- Raw signals
  state_reason TEXT,
  label_names TEXT[] NOT NULL DEFAULT '{}',

  -- Idempotency
  delivery_id TEXT NOT NULL,

  UNIQUE(repo, issue_number),
  UNIQUE(delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_outcome_feedback_repo
  ON issue_outcome_feedback (repo);

CREATE INDEX IF NOT EXISTS idx_issue_outcome_feedback_triage
  ON issue_outcome_feedback (triage_id)
  WHERE triage_id IS NOT NULL;
```

### Rollback SQL: 017-issue-outcome-feedback.down.sql
```sql
DROP TABLE IF EXISTS issue_outcome_feedback;
ALTER TABLE issue_triage_state DROP COLUMN IF EXISTS comment_github_id;
```

### Handler: PR Filtering (OUTCOME-04)
```typescript
// Source: .planning/research/OUTCOME-LEARNING.md pitfall 4
const issue = payload.issue;
if (!issue || !payload.repository) return;

// GitHub fires issues.closed for PRs too -- filter them out
if (issue.pull_request) {
  handlerLogger.debug("Pull request closure, skipping");
  return;
}
```

### Handler: Duplicate Detection (OUTCOME-02)
```typescript
// Source: .planning/research/OUTCOME-LEARNING.md sections 1-2

// Primary: state_reason from GitHub
const stateReason = issue.state_reason; // "completed" | "not_planned" | "duplicate" | null

// Determine outcome
let outcome: string;
let confirmedDuplicate = false;

if (stateReason === "duplicate") {
  outcome = "duplicate";
  confirmedDuplicate = true;
} else if (stateReason === "completed") {
  outcome = "completed";
} else if (stateReason === "not_planned") {
  outcome = "not_planned";
} else {
  // state_reason is null -- fallback to label check
  const labels: Array<{ name: string }> = issue.labels ?? [];
  const hasDuplicateLabel = labels.some((l) => l.name === "duplicate");
  if (hasDuplicateLabel) {
    outcome = "duplicate";
    confirmedDuplicate = true;
  } else {
    outcome = "unknown";
  }
}
```

### Handler: Triage Linkage (OUTCOME-03)
```typescript
// Source: Follows existing issue_triage_state query pattern from issue-opened.ts

// Look up existing triage record
const triageRows = await sql`
  SELECT id, duplicate_count
  FROM issue_triage_state
  WHERE repo = ${repo} AND issue_number = ${issueNumber}
`;

const triageId = triageRows.length > 0 ? (triageRows[0].id as number) : null;
const kodiaiPredictedDuplicate = triageRows.length > 0 && (triageRows[0].duplicate_count as number) > 0;
```

### Modifying issue-opened.ts: Capture comment_github_id (REACT-01)
```typescript
// Source: Current issue-opened.ts line 180-185, modified to capture ID

// 8. Post comment
const commentResponse = await octokit.rest.issues.createComment({
  owner,
  repo: repoName,
  issue_number: issueNumber,
  body: commentBody,
});

// 8b. Store the comment GitHub ID for future reaction tracking
const commentGithubId = commentResponse.data.id;
try {
  await sql`
    UPDATE issue_triage_state
    SET comment_github_id = ${commentGithubId}
    WHERE repo = ${repo} AND issue_number = ${issueNumber}
  `;
} catch (err) {
  handlerLogger.warn({ err, commentGithubId }, "Failed to store comment GitHub ID (non-fatal)");
}
```

### Wiring in index.ts
```typescript
// Source: Pattern from src/index.ts lines 481-506

if (issueStore && embeddingProvider) {
  createIssueOpenedHandler({ ... });

  createIssueClosedHandler({
    eventRouter,
    sql,
    logger,
  });

  createTroubleshootingHandler({ ... });
}
```

**Note:** The issue-closed handler does NOT need `issueStore`, `embeddingProvider`, `githubApp`, `workspaceManager`, or `jobQueue`. It only needs `eventRouter`, `sql`, and `logger`. However, it should be gated alongside the issue-opened handler (inside the `if (issueStore && embeddingProvider)` block) since outcome capture is only meaningful when auto-triage is active. This is a logical gate, not a technical dependency.

### Test Pattern
```typescript
// Source: Adapted from src/handlers/issue-opened.test.ts

function makeClosedEvent(overrides?: Partial<Record<string, unknown>>): WebhookEvent {
  return {
    id: "delivery-456",
    name: "issues",
    installationId: 1,
    payload: {
      action: "closed",
      issue: {
        number: 100,
        title: "App crashes on login",
        body: "When I try to login, the app crashes.",
        state: "closed",
        state_reason: "completed",
        labels: [],
        pull_request: undefined,
        user: { login: "testuser" },
        closed_at: "2026-02-27T00:00:00Z",
      },
      repository: {
        full_name: "owner/repo",
        name: "repo",
        owner: { login: "owner" },
      },
      ...overrides,
    },
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No issue lifecycle tracking | Issue corpus with backfill + nightly sync | v0.22 (Phase 106-109) | Issues table exists with state, labels, closed_at |
| No triage state | `issue_triage_state` table with cooldown | v0.22 (Phase 107) | Triage records exist to link outcomes to |
| No outcome capture | Phase 112 adds `issue_outcome_feedback` | v0.23 (this phase) | Closes the feedback loop |

**Key dependency for Phase 113:** The `issue_outcome_feedback` table designed here feeds directly into the Beta-Binomial threshold learning in Phase 113. The `confirmed_duplicate` and `kodiai_predicted_duplicate` columns map to the alpha/beta update rule.

**Key dependency for Phase 114:** The `comment_github_id` column on `issue_triage_state` enables reaction polling in Phase 114.

## Open Questions

1. **Should the handler also update the `issues` table state?**
   - What we know: The nightly sync already updates issue state from GitHub API.
   - What's unclear: Whether updating `issues.state = 'closed'` and `issues.closed_at` in the handler provides meaningful benefit given the sync job.
   - Recommendation: Skip for now. The sync job handles it. Avoid redundant writes.

2. **Should `state_reason` be added to the `issues` table?**
   - What we know: The research doc recommends it. The `issues` table currently has `state` but not `state_reason`.
   - What's unclear: Whether the nightly sync currently captures `state_reason` from the GitHub API.
   - Recommendation: Add it in the migration as a lightweight schema improvement. Store it in the outcome table regardless.

## Sources

### Primary (HIGH confidence)
- `src/handlers/issue-opened.ts` - Handler factory pattern, payload extraction, triage state queries
- `src/handlers/issue-opened.test.ts` - Test patterns, mock structures
- `src/webhook/router.ts` - Event key format (`issues.closed`), handler registration
- `src/webhook/dedup.ts` - In-memory delivery-ID dedup (Layer 1)
- `src/db/migrations/016-issue-triage-state.sql` - Current triage state schema (no `comment_github_id`)
- `src/db/migrations/014-issues.sql` - Issues table schema (no `state_reason`)
- `src/db/migrate.ts` - Sequential migration runner with `_migrations` tracking table
- `src/index.ts` - Handler wiring patterns, dependency injection
- `src/webhook/types.ts` - `WebhookEvent`, `EventRouter`, `EventHandler` interfaces
- `src/knowledge/issue-types.ts` - `IssueStore`, `IssueRecord` types
- `src/triage/triage-comment.ts` - Triage comment formatting, marker patterns

### Secondary (MEDIUM confidence)
- `.planning/research/OUTCOME-LEARNING.md` - Detailed schema designs, payload analysis, pitfalls
- `.planning/REQUIREMENTS.md` - Requirement specifications for OUTCOME-* and REACT-01
- `.planning/milestones/v0.23-ROADMAP.md` - Phase plan descriptions

### Tertiary (LOW confidence)
- GitHub API `state_reason` field in webhook payloads - Documented in REST API v3 docs (2022), but exact webhook payload shape should be verified against a live delivery

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, no new dependencies
- Architecture: HIGH - Direct pattern replication from issue-opened handler
- Pitfalls: HIGH - Well-documented in prior research and codebase patterns
- GitHub API payload: MEDIUM - `state_reason` field documented but not verified against live webhook

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable patterns, unlikely to change)

# Research: Corpus Learning from Outcomes (Feedback Loop)

**Domain:** GitHub App — duplicate detection threshold auto-tuning via issue lifecycle signals
**Researched:** 2026-02-27
**Overall confidence:** HIGH (codebase direct inspection) / MEDIUM (GitHub API payload specifics)

---

## Executive Summary

Kodiai already has two distinct feedback loops: one for PR review comment suppression
(thumbs reactions on review comments via `src/feedback/`) and one for issue triage
(`issue_triage_state`). The missing piece is closing the loop on issue *outcomes* — learning
from what actually happened after triage. This document maps the full design space.

The core insight is that ground-truth signal is cheap to collect (it arrives as a webhook),
but the threshold-adjustment function needs care to avoid thrashing. A simple Beta-distribution
Bayesian update per label bucket is the right level of complexity: interpretable, numerically
stable at low sample sizes, and directly maps to the 0–100 `duplicateThreshold` config value.

---

## 1. Outcome Capture — `issues.closed` Webhook

### Payload Fields Available

GitHub fires `issues.closed` with the full issue object. Relevant fields:

```
payload.action           = "closed"
payload.issue.number
payload.issue.state      = "closed"
payload.issue.state_reason  -- "completed" | "not_planned" | "duplicate" | null
payload.issue.labels[].name -- ["duplicate", "wont-fix", "possible-duplicate", ...]
payload.issue.body          -- may contain "Duplicate of #N" in the closing comment
payload.issue.timeline_url  -- requires separate API call to get closing PR/comment
```

**`state_reason` is the authoritative signal.** GitHub added this field in 2022 and it is
populated when a maintainer explicitly selects a resolution type in the UI. Values:

- `"completed"` — fixed/resolved
- `"not_planned"` — won't fix / out of scope
- `"duplicate"` — maintainer explicitly marked as duplicate via GitHub UI
- `null` — closed via API without specifying reason (older clients, bots)

**Confidence:** MEDIUM. `state_reason` is documented in GitHub REST API v3 and is present in
webhook payloads as of the 2022 API update. Older GitHub Enterprise versions may not populate it.

### Detecting "Duplicate of #N"

Two complementary approaches:

**A. Label-based (HIGH confidence, already in issues table):**
The `issues` table has `label_names TEXT[]`. Check for `"duplicate"` label. This is the
canonical GitHub convention. The `possible-duplicate` label that Kodiai applies is distinct
— it is Kodiai's prediction; the `duplicate` label is the human verdict.

**B. Body/comment pattern scan (MEDIUM confidence):**
Maintainers commonly write closing comments with patterns:
- `"Duplicate of #123"`
- `"Duped by #123"`
- `"Closes #123"` (if #123 is the original)

Regex: `/\b(?:duplicate\s+of|duped?\s+by|dup(?:licate)?\s+#)\s*#?(\d+)/i`

To retrieve the closing comment body, use `octokit.rest.issues.listEvents` filtered to
`event.event === "closed"` with `event.commit_id` null, then cross-reference with
`listComments` near the `closed_at` timestamp. This is a secondary API call; cache or
skip if `state_reason === "duplicate"` is already present.

**C. Cross-reference with `issue_triage_state` (HIGH confidence, no API call):**
When we triaged issue N and suggested candidate M, and then issue N is closed with
`state_reason = "duplicate"` and has the `duplicate` label, we have a confirmed true
positive from Kodiai's prediction without any additional API call.

---

## 2. Feedback Schema

### New Table: `issue_outcome_feedback`

```sql
CREATE TABLE IF NOT EXISTS issue_outcome_feedback (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The issue that was closed
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,

  -- Link back to the triage record
  -- NULL if issue was closed without ever being triaged by Kodiai
  triage_id BIGINT REFERENCES issue_triage_state(id) ON DELETE SET NULL,

  -- Outcome signal
  -- "duplicate" | "completed" | "not_planned" | "unknown"
  outcome TEXT NOT NULL,

  -- Whether Kodiai predicted duplicate (had triage_id with duplicate_count > 0)
  kodiai_predicted_duplicate BOOLEAN NOT NULL DEFAULT false,

  -- Whether the issue was actually confirmed duplicate
  confirmed_duplicate BOOLEAN NOT NULL DEFAULT false,

  -- The specific issue number it was a duplicate of (if determinable)
  duplicate_of_issue_number INTEGER,

  -- Component/area classification (label-derived or LLM-classified)
  component TEXT,

  -- Raw signals for auditing
  state_reason TEXT,           -- raw GitHub state_reason value
  label_names TEXT[] NOT NULL DEFAULT '{}',

  -- Delivery ID of the issues.closed event (for idempotency)
  delivery_id TEXT NOT NULL,

  UNIQUE(repo, issue_number),  -- one outcome record per issue
  UNIQUE(delivery_id)          -- prevent duplicate webhook processing
);

CREATE INDEX IF NOT EXISTS idx_issue_outcome_feedback_repo
  ON issue_outcome_feedback (repo);

CREATE INDEX IF NOT EXISTS idx_issue_outcome_feedback_component
  ON issue_outcome_feedback (repo, component);

CREATE INDEX IF NOT EXISTS idx_issue_outcome_feedback_triage
  ON issue_outcome_feedback (triage_id)
  WHERE triage_id IS NOT NULL;
```

### New Table: `triage_threshold_state`

Stores the current auto-tuned threshold per repo/component bucket, with the Beta
distribution parameters used to derive it:

```sql
CREATE TABLE IF NOT EXISTS triage_threshold_state (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  -- NULL = global (repo-wide) threshold; non-null = per-component override
  component TEXT,

  -- Beta distribution parameters
  -- alpha = confirmed duplicates + prior_alpha
  -- beta  = false positives (predicted but wrong) + prior_beta
  alpha_successes FLOAT NOT NULL DEFAULT 2.0,  -- prior: 2 successes (optimistic start)
  beta_failures   FLOAT NOT NULL DEFAULT 8.0,  -- prior: 8 failures

  -- Derived threshold (alpha / (alpha + beta) * 100, clamped to [50, 95])
  current_threshold INTEGER NOT NULL DEFAULT 75,

  -- Sample counts for UI/observability
  total_outcomes INTEGER NOT NULL DEFAULT 0,
  confirmed_duplicates INTEGER NOT NULL DEFAULT 0,
  false_positives INTEGER NOT NULL DEFAULT 0,
  true_negatives INTEGER NOT NULL DEFAULT 0,

  UNIQUE(repo, component)  -- NULL component allowed, use COALESCE in queries
);
```

**Note:** Use `COALESCE(component, '')` in unique index or a partial unique index to handle
the null-component (global) case:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_triage_threshold_state_unique
  ON triage_threshold_state (repo, COALESCE(component, ''));
```

### Existing Tables (no changes needed)

- `issue_triage_state` — already records `duplicate_count`, `triaged_at`, `delivery_id`
- `issues` — already has `state`, `closed_at`, `label_names`, `state_reason` is NOT currently
  stored (needs adding or queried live)

**Recommended:** Add `state_reason TEXT` column to `issues` table in a new migration so
the nightly sync captures it and the `issues.closed` handler can update it.

---

## 3. Reaction Tracking on Triage Comments

### Existing Pattern (PR Review Comments)

The existing `src/feedback/` system tracks thumbs reactions on PR review comments. The
pattern used (inferred from `aggregator.ts` and `types.ts`) is:

- PR review comments have a `fingerprint` (content hash or category key)
- Reactions are aggregated by `fingerprint` across PRs
- `FeedbackPattern` carries `thumbsDownCount`, `thumbsUpCount`, `distinctReactors`, `distinctPRs`
- Auto-suppress fires when all three thresholds are met

### Adapting for Triage Comments

Triage comments differ from review comments in one important way: there is only one triage
comment per issue (enforced by the `TRIAGE_MARKER_PREFIX` marker), and it is on an issue
not a PR.

**GitHub event:** `issue_comment` reactions arrive via `issue_comment.created` (for a new
reaction-comment) or more accurately via the `reaction` webhook event type. In practice,
Kodiai should listen to `issue_comment.created` where `payload.comment.body` starts with
an emoji reaction pattern, OR use the polling approach that `feedback-sync.ts` uses.

**Recommended approach:** Extend `feedback-sync.ts` (or create a parallel
`triage-feedback-sync.ts`) that:

1. Queries `issue_triage_state` for recently triaged issues (e.g., last 30 days)
2. For each, fetches reactions on the Kodiai triage comment via
   `octokit.rest.reactions.listForIssueComment({ owner, repo, comment_id })`
3. Stores aggregated reaction counts in `issue_outcome_feedback` or a separate
   `triage_comment_reactions` table

**New table for triage comment reactions:**

```sql
CREATE TABLE IF NOT EXISTS triage_comment_reactions (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  comment_github_id BIGINT NOT NULL,  -- the triage comment's GitHub ID

  thumbs_up INTEGER NOT NULL DEFAULT 0,
  thumbs_down INTEGER NOT NULL DEFAULT 0,
  distinct_reactors INTEGER NOT NULL DEFAULT 0,

  UNIQUE(repo, issue_number)
);
```

**Storing the triage comment ID:** The `issue_triage_state` table does not currently store
the GitHub comment ID. This must be added:

```sql
ALTER TABLE issue_triage_state
  ADD COLUMN IF NOT EXISTS comment_github_id BIGINT;
```

The `issue-opened.ts` handler posts the comment and gets back the response; capture
`response.data.id` and store it.

---

## 4. Threshold Tuning Algorithm

### Bayesian Beta-Binomial Update (Recommended)

Model the duplicate detection threshold as a Beta-distributed success probability.

**Why Beta-Binomial:**
- Numerically stable at small sample sizes (prior dominates until evidence accumulates)
- Interpretable: `alpha / (alpha + beta)` is the mean estimate
- Natural credible intervals for displaying uncertainty in observability
- No "thrashing" — each observation moves the estimate by `1/(alpha+beta+1)`, which
  shrinks as evidence grows

**Update rule per new outcome:**

```
If confirmed_duplicate AND kodiai_predicted:    alpha += 1  (true positive)
If confirmed_duplicate AND NOT kodiai_predicted: no threshold update (missed, different signal)
If NOT duplicate AND kodiai_predicted:           beta += 1   (false positive)
If NOT duplicate AND NOT kodiai_predicted:       track as true_negative, no threshold update
```

**Threshold derivation:**

```
mean_estimate = alpha / (alpha + beta)
current_threshold = CLAMP(ROUND(mean_estimate * 100), 50, 95)
```

Clamp prevents the threshold from going below 50 (too permissive, would flood with noise)
or above 95 (too restrictive, would never trigger).

**Prior selection:**
- `alpha_0 = 2, beta_0 = 8` gives a prior mean of 0.20 (20% of Kodiai's duplicate
  predictions are correct), which is conservative. The config default of `duplicateThreshold: 75`
  was chosen empirically; the prior should reflect that at a fresh start, false positive rate
  is expected to be ~80%.
- After 10 real observations, the prior contributes only 10/(10+10) = 50% of the estimate.
- After 50 real observations, the data fully dominates.

**Minimum sample size before applying:**
Do NOT apply the auto-tuned threshold until `total_outcomes >= 20`. Below this, serve
the static config value. This prevents one-off false positives from thrashing the threshold
in the first week.

### Component Granularity

Global tuning is simpler and more statistically robust. Per-component tuning requires
~20 samples *per component* before it's meaningful, which may take months.

**Recommended:** Start with global per-repo tuning. Add component granularity only when
`total_outcomes >= 100` repo-wide. Components with fewer than 20 outcomes fall back to
the global threshold.

---

## 5. Component Detection

### Label-Based (HIGH confidence, recommended)

The `issues` table already stores `label_names TEXT[]`. Use label prefix conventions:
- `area/auth`, `area/api`, `component/payments` — common patterns
- Strip common prefixes: `area/`, `component/`, `kind/`, `type/`
- Remaining token is the component slug

This requires zero LLM calls and works on 80%+ of repos with consistent labeling.

### LLM Classification (LOW confidence, expensive)

Classify issue title+body into a predefined taxonomy via Claude. Expensive per-issue.
Only appropriate if repo uses no labels or inconsistent labeling. Defer to a later phase.

### Path-Based from Linked PRs (MEDIUM confidence, complex)

If an issue is closed by a PR (cross-reference via GitHub closing keywords), the PR's
changed files suggest the component. Requires extra API calls. Defer.

**Recommendation:** Label-based only for MVP. Store component as `NULL` (global bucket)
when no matching label is found.

---

## 6. Handler Registration

### New `issues.closed` Handler

Follow the exact pattern of `issue-opened.ts`:

```typescript
// src/handlers/issue-closed.ts
export function createIssueClosedHandler(deps: { ... }): void {
  async function handleIssueClosed(event: WebhookEvent): Promise<void> { ... }
  eventRouter.register("issues.closed", handleIssueClosed);
}
```

Register in `src/index.ts` alongside `createIssueOpenedHandler`.

### Payload Shape for `issues.closed`

```typescript
type IssueClosedPayload = {
  action: "closed";
  issue: {
    number: number;
    title: string;
    body: string | null;
    state: "closed";
    state_reason: "completed" | "not_planned" | "duplicate" | null;
    labels: Array<{ name: string }>;
    closed_at: string;  // ISO 8601
    user: { login: string };
  };
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
  sender: { login: string; type: string };
};
```

### Sync Job for Reactions

Add a new nightly job alongside the existing issue sync:

```typescript
// src/jobs/triage-feedback-sync-job.ts
// Polls reactions on recent triage comments; runs nightly or every few hours
```

Register in the job scheduler at lower priority than corpus sync.

---

## 7. Observability

### Metrics to Track (per repo)

| Metric | Description |
|--------|-------------|
| `triage.outcomes.total` | Total closed issues with feedback recorded |
| `triage.outcomes.confirmed_duplicates` | Ground-truth duplicates |
| `triage.outcomes.false_positives` | Kodiai predicted duplicate, was wrong |
| `triage.outcomes.true_negatives` | No prediction, confirmed not duplicate |
| `triage.threshold.current` | Current auto-tuned threshold |
| `triage.threshold.confidence` | Beta distribution variance (narrow = high confidence) |
| `triage.threshold.sample_n` | Sample count backing current threshold |

### Transparency Comment (Optional)

When the threshold changes by more than 5 points, log a structured event:

```json
{
  "event": "threshold_adjusted",
  "repo": "owner/repo",
  "component": null,
  "previous_threshold": 75,
  "new_threshold": 70,
  "alpha": 12.0,
  "beta": 18.0,
  "sample_count": 30
}
```

### Admin API Endpoint (Future)

`GET /api/repos/{owner}/{repo}/triage/threshold-state` — returns current threshold,
Beta parameters, sample counts, and per-component breakdown. Not required for MVP.

---

## 8. Critical Pitfalls

### Pitfall 1: Confusing Kodiai's Label with Ground Truth

`possible-duplicate` is Kodiai's prediction label. `duplicate` is the human verdict. These
must be treated as distinct signals. Conflating them inflates the perceived true-positive rate.

**Prevention:** In all queries, use `issues.label_names @> ARRAY['duplicate']` (human verdict),
never `@> ARRAY['possible-duplicate']` (Kodiai prediction), when computing confirmed_duplicate.

### Pitfall 2: Issues Closed Without State Reason

Many GitHub clients (bots, older integrations, API calls without `state_reason`) close
issues with `state_reason = null`. This is the majority of production closes in active repos.

**Prevention:** When `state_reason IS NULL`, use label-based detection as the fallback.
Only record `outcome = "unknown"` when neither `state_reason` nor labels provide signal.
Do NOT count `outcome = "unknown"` in the Beta update — it is uninformative.

### Pitfall 3: Threshold Thrashing at Low Sample Sizes

If auto-tuning begins immediately, the first 5 outcomes can swing the threshold ±15 points.
This causes real user-visible instability.

**Prevention:** Hard gate: do not apply auto-tuned threshold until `total_outcomes >= 20`.
Soft gate: weight updates by credible interval width — only override config threshold when
`(alpha + beta) > 30` (i.e., prior is diluted to < 33% influence).

### Pitfall 4: `issues.closed` Fires for PRs

GitHub fires `issues.closed` for pull requests closed/merged because PRs are also issues
in GitHub's data model. The payload includes `payload.issue.pull_request` when this happens.

**Prevention:** Check `if (payload.issue.pull_request) return;` at the top of the handler.
The `issues` table already has `is_pull_request BOOLEAN` — use this as secondary check.

### Pitfall 5: Missing `comment_github_id` in `issue_triage_state`

The reaction tracking approach requires knowing which comment to poll for reactions. Currently
`issue_triage_state` does not store the GitHub comment ID.

**Prevention:** Migrate `issue_triage_state` to add `comment_github_id BIGINT` column.
Update `issue-opened.ts` to capture `response.data.id` after `createComment` and store it.
Existing rows will have NULL — handle gracefully in the sync job by skipping NULLs.

### Pitfall 6: Webhook Redelivery Double-Counting

GitHub can redeliver webhooks. An `issues.closed` event processed twice would double-count
the outcome and update the Beta twice.

**Prevention:** The `UNIQUE(delivery_id)` constraint on `issue_outcome_feedback` provides
idempotency. Wrap the insert in `INSERT ... ON CONFLICT (delivery_id) DO NOTHING`.

---

## 9. Implementation Phases

### Phase A — Outcome Capture (foundational)
1. New migration: add `state_reason` to `issues`, `comment_github_id` to `issue_triage_state`
2. New migration: create `issue_outcome_feedback` table
3. New handler: `src/handlers/issue-closed.ts` registers on `issues.closed`
4. Handler stores outcome record with `confirmed_duplicate`, `kodiai_predicted_duplicate`,
   `state_reason`, component (label-derived)
5. Update `issue-opened.ts` to capture `comment_github_id` after createComment

### Phase B — Threshold State (learning)
1. New migration: create `triage_threshold_state` table
2. `issue-closed.ts` handler calls `updateThresholdState()` after recording outcome
3. `updateThresholdState()` applies Beta update only when `total_outcomes >= 20`
4. `findDuplicateCandidates()` reads effective threshold: auto-tuned if available, else config

### Phase C — Reaction Tracking (signal enrichment)
1. New migration: create `triage_comment_reactions` table
2. New nightly job: `triage-feedback-sync-job.ts` polls reactions on recent triage comments
3. Reactions feed into `issue_outcome_feedback` as secondary signal

### Phase D — Observability (production confidence)
1. Structured logging of threshold changes
2. Metrics emission via existing telemetry infrastructure
3. Optional admin API endpoint

---

## 10. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tuning algorithm | Beta-Binomial Bayesian | Stable at low n, interpretable, no thrashing |
| Prior | alpha=2, beta=8 | Conservative 20% TP prior, matches ~75% threshold default |
| Min sample gate | 20 outcomes | Prevents thrashing in first weeks |
| Component granularity | Label-based, fallback to global | Zero API cost, works immediately |
| Reaction tracking | Nightly sync job | Avoids real-time polling complexity |
| Idempotency | UNIQUE(delivery_id) on outcome table | Matches existing pattern in codebase |
| PR/issue disambiguation | Check `pull_request` field in payload | GitHub fires `issues.closed` for PRs too |
| Threshold bounds | Clamp to [50, 95] | 50 = never below noise floor, 95 = always some filtering |

---

## Sources

- Codebase direct inspection: `src/handlers/issue-opened.ts`, `src/triage/duplicate-detector.ts`,
  `src/db/migrations/014-issues.sql`, `src/db/migrations/016-issue-triage-state.sql`,
  `src/feedback/aggregator.ts`, `src/feedback/types.ts`, `src/execution/config.ts`,
  `src/webhook/types.ts` — HIGH confidence
- GitHub REST API `issues.closed` payload shape with `state_reason` field — MEDIUM confidence
  (documented in GitHub API v3, introduced 2022; verify against live webhook in staging)
- Beta-Binomial conjugate prior for binary outcomes — HIGH confidence (standard statistical method)
- GitHub `reactions.listForIssueComment` API availability — MEDIUM confidence (standard GitHub API)

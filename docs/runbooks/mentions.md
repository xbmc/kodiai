# Mentions Debug Runbook

Use this runbook when an `@kodiai` or `@claude` mention does not produce the expected reply on GitHub.

## Expected Behavior (Surfaces)

Mentions can arrive via three webhook event types. The handler normalizes them into four surfaces.

- `issue_comment.created` -> surface: `issue_comment` (issue) or `pr_comment` (PR top-level comment)
- `pull_request_review_comment.created` -> surface: `pr_review_comment` (inline diff thread)
- `pull_request_review.submitted` -> surface: `pr_review_body` (review body text)

Expected response location:

- `pr_review_comment`: reply in the same inline thread (uses GitHub review-comment reply API)
- `pr_comment` / `issue_comment` / `pr_review_body`: create a new top-level comment on the issue/PR

Tracking/ack:

- Best-effort ":eyes:" reaction is added to the trigger comment (non-blocking)
- No tracking comment is created (tracking is eyes-only)

## 0) Collect the Minimal Evidence

From the GitHub UI, collect:

- PR/Issue URL
- Trigger comment URL (or inline comment URL)
- The exact mention text (copy/paste)
- The webhook delivery ID (`X-GitHub-Delivery`) if available

## 1) Confirm the GitHub Webhook Delivery Exists

Preferred: GitHub App UI

1) GitHub App Settings -> Advanced -> Recent Deliveries
2) Find the delivery for the correct repo + event + action:
   - `issue_comment` action `created`
   - `pull_request_review_comment` action `created`
   - `pull_request_review` action `submitted`
3) Copy `X-GitHub-Delivery` (this is the correlation key: `deliveryId`)

Optional: `gh` API (requires token scope)

Note: Fetching delivery status metadata often requires `admin:repo_hook` scope on the `gh` token.

```sh
gh api repos/<owner>/<repo>/hooks --jq '.[].id'
gh api repos/<owner>/<repo>/hooks/<hook-id>/deliveries --jq '.[] | {id,event,action,status_code,delivered_at}'
```

Expected signal:

- A delivery exists for the correct `event` and `action`.
- Delivery headers include `X-GitHub-Delivery`.

## 2) Correlate Ingress and Router Logs by deliveryId

Search application logs for the exact `X-GitHub-Delivery` value.

```sh
# Example Azure Log Analytics query
AppTraces
| where Message has "deliveryId"
| where Message has "<delivery-id>"
| project TimeGenerated, Message
| order by TimeGenerated asc
```

Expected log chain includes:

- `Webhook accepted and queued for dispatch` (ingress)
  - Source: `src/routes/webhooks.ts` (extracts `x-github-delivery`)
- `Router evaluated dispatch keys` (routing)
  - Source: `src/webhook/router.ts`
- Either:
  - `Dispatched to N handler(s)`
  - OR `Event skipped because no handlers matched`

If the ingress log is missing for a real delivery, suspect:

- Wrong webhook URL or service unavailable
- Signature verification failed (look for `Webhook signature verification failed`)
- Delivery deduplicated (look for `Duplicate delivery skipped`)

## Queue Lane Model and Explicit Review Stale-Work Signals

The per-installation queue now has three operator-visible lanes. For mention debugging,
check the queue logs before assuming the worker never ran:

- `interactive-review` — explicit `@kodiai review` requests on a PR. These should enqueue from the mention handler with:
  - `lane=interactive-review`
  - `jobType=mention`
  - `key=<owner>/<repo>#<pr-number>`
- `review` — automatic PR review jobs (`pull_request.opened`, `pull_request.review_requested`, `pull_request.synchronize`, and related full-review triggers).
- `sync` — background work that is not the main automatic review lane, including non-review mention requests plus follow-up jobs such as `feedback-sync`, `review-comment-sync`, and similar auxiliary work. These share the installation queue but are not the main review worker.

For any suspected explicit review issue, look at these fields first on `Enqueuing job for installation`, `Job execution started`, and the stale-predecessor telemetry line when it exists:

- `lane`
- `key`
- `phase`
- `predecessorPhase`
- `predecessorAgeMs`

What those fields mean:

- `lane` tells you whether the request actually went onto the explicit review lane (`interactive-review`) or was routed somewhere else.
- `key` is the PR-family queue key. For explicit reviews it should be the stable PR key (`owner/repo#pr`), not a comment-specific value.
- `phase` on the queue logs is the coarse queue lifecycle state:
  - `queued` on `Enqueuing job for installation`
  - `running` on `Job execution started`
- `predecessorPhase` and `predecessorAgeMs` only appear when an explicit review claim discovers an older same-PR review-family attempt.
  - For explicit mention-review attempts, the review-family phases currently move through `claimed` and `executor-dispatch`; some mention-handler approval/fallback publish paths also promote the attempt to `publish`.
  - For older automatic review attempts observed as predecessors, `predecessorPhase` can report the finer pre-executor checkpoints that persist across awaits (`workspace-create`, `incremental-diff`) before the executor runs.

### Explicit Review Predecessor Telemetry

When `@kodiai review` successfully claims the interactive-review lane but detects an older same-PR review-family attempt, the mention handler logs:

- `Explicit review claim found a stale predecessor attempt`

Important fields on that log line:

- `reviewFamilyKey`
- `reviewWorkAttemptId`
- `predecessorAttemptId`
- `predecessorPhase`
- `predecessorAgeMs`

Interpretation:

- `predecessorAttemptId` identifies the older automatic or explicit review-family attempt.
- `predecessorPhase` tells you the last review-family phase that older attempt reached.
- `predecessorAgeMs` tells you how long that predecessor had been idle when the explicit claim was made.

This is the main stale-review signal for explicit review mentions: it proves the new same-PR review-family claim was made while an older review-family attempt still existed. It does **not** by itself prove the interactive-review lane started running — use `Enqueuing job for installation` / `Job execution started` for queue acceptance.

## Evidence Bundle (Write-Mode)

When write-mode is enabled and an `apply:` / `change:` mention creates or reuses a PR, the handler emits a single structured log line:

- Message: `Evidence bundle`
- Fields:
  - `evidenceType=write-mode`
  - `outcome=updated-pr-branch|created-pr|reused-pr|skipped-idempotent`
  - `deliveryId`
  - `installationId`
  - `owner`
  - `repoName`
  - `repo`
  - `sourcePrNumber`
  - `triggerCommentId`
  - `triggerCommentUrl`
  - `writeOutputKey`
  - `branchName`
  - `prUrl`
  - `commitSha` (for created PR)

### Grep Evidence Bundle by deliveryId

Use the GitHub App deliveries UI to copy `X-GitHub-Delivery`, then search logs for:

- `deliveryId: <X-GitHub-Delivery>`
- message `Evidence bundle`

Example (Log Analytics):

```sh
AppTraces
| where Message has "Evidence bundle"
| where Message has "deliveryId"
| where Message has "<delivery-id>"
| project TimeGenerated, Message
| order by TimeGenerated asc
```

Additional query snippets:

```sh
# Write refusals by reason code (last 24h)
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s has "Write request refused"
| project TimeGenerated, Log_s
| order by TimeGenerated desc
```

```sh
# Recheck/rereview outcomes and fallbacks
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s has "rereview" or Log_s has "fallback reviewer"
| project TimeGenerated, Log_s
| order by TimeGenerated desc
```

## 3) Confirm Mention Detection + Gate Decisions

For the same `deliveryId`, search for mention handler logs.

Key handler messages (source: `src/handlers/mention.ts`):

- Skip gates:
  - `Mentions disabled in config, skipping`
  - `Mention does not match accepted handles for repo; skipping`
  - `Mention contained no question after stripping mention; skipping`
- Start processing:
  - `Processing mention`
    - includes: `surface`, `owner`, `repo`, `issueNumber`, `prNumber`, `commentAuthor`, `acceptClaudeAlias`

Notes:

- `@claude` is only accepted if repo config allows it (`mention.acceptClaudeAlias`).
- If the mention text is just `@kodiai` / `@claude` with no question, the handler will skip.

### Write-intent gating (apply/change)

Mentions support an explicit "write intent" prefix for future mention-driven changes:

- `apply: <request>`
- `change: <request>`
- `plan: <request>` (plan only; no writes)

Behavior today:

- If `write.enabled` is **false** (default), Kodiai will refuse to apply changes and will reply with a short message explaining how to enable write mode.
- `plan:` always produces a plan and does not write, even if `write.enabled=true`.
- In logs, expect a gate skip with:
  - `gate=write-mode`
  - `skipReason=write-disabled`

To enable for a repo, add to `.kodiai.yml`:

```yml
write:
  enabled: true
```

### Write policy (allow/deny paths, secret scan, rate limit)

When write-mode is enabled, the server enforces policy before committing/pushing:

- `write.denyPaths`: blocks changes to matching paths (deny wins)
- `write.allowPaths`: if set, every changed path must match an allow pattern
- `write.secretScan.enabled`: blocks if staged diffs look like secrets (keys/tokens)
- `write.minIntervalSeconds`: basic write request rate limiting

Notes:

- Rate limiting is best-effort (in-memory, per process). In multi-replica deployments it is not a hard guarantee.
- Path patterns use glob semantics. Examples:
  - `.github/` matches everything under `.github/` (equivalent to `.github/**`)
  - `**/*.md` matches markdown files anywhere

Secret scan notes:

- In addition to known token/key patterns, write-mode performs a best-effort entropy scan on added lines.
- False positives are possible; if needed, narrow writes with `write.allowPaths`.

Common refusal reasons:

- `write-policy-denied-path`: staged change matches denyPaths
- `write-policy-not-allowed`: staged change did not match allowPaths
- `write-policy-secret-detected`: suspected secret present in staged diff
- `rate-limited`: write requests too frequent

Operator quick map:

- `write-policy-denied-path`
  - check `File` + `Matched pattern` in the refusal
  - action: narrow/remove the specific denyPaths entry only if explicitly intended
- `write-policy-not-allowed`
  - check `File` and the suggested minimal `allowPaths` snippet
  - action: add the narrowest path pattern needed, then retry
- `write-policy-secret-detected`
  - check `Detector` and `File`
  - action: remove/redact secret-like additions and retry (do not bypass by default)
- `write-policy-no-changes`
  - action: restate request with explicit file + edit target
- `rate-limited`
  - action: wait for `write.minIntervalSeconds` window or lower it in `.kodiai.yml`

## 4) Verify Eyes Reaction Attempt (Non-Blocking)

The handler tries to add an ":eyes:" reaction to the trigger comment.

- Success: you see an eyes reaction quickly
- Failure: log line `Failed to add eyes reaction` (processing continues)
- Special case: `pr_review_body` does not support reactions (skip silently)

If you see eyes but no reply, do not assume failure; move to steps 5-7.

## 5) Confirm the Reply Path Chosen (Thread vs Top-Level)

Reply location is determined by the surface:

- Inline diff thread (`pr_review_comment`): reply in-thread using:
  - Code: `src/execution/mcp/review-comment-thread-server.ts`
  - GitHub API: `pulls.createReplyForReviewComment`
- Top-level comment (`pr_comment` / `issue_comment` / `pr_review_body`): create issue/PR comment using:
  - Code: `src/execution/mcp/comment-server.ts`
  - GitHub API: `issues.createComment`

If an inline-thread mention produced a top-level comment instead, verify that the webhook event was actually `pull_request_review_comment.created` (not `issue_comment.created`).

## 6) Check Context Build (Non-Fatal)

The handler builds conversation + PR context best-effort.

Look for:

- `Failed to build mention context; proceeding with empty context`

This should not prevent a reply, but can reduce answer quality.

Relevant code:

- `src/execution/mention-context.ts`
- `src/execution/mention-prompt.ts`

## 7) Confirm Claude Execution Completed

Look for:

- `Mention execution completed`
  - includes: `conclusion`, `costUsd`, `numTurns`, `durationMs`, `sessionId`

Outcomes:

- `conclusion: success` or `failure`: the Claude Code run finished (not necessarily that it posted a comment)
- `conclusion: error`: the handler will attempt to post/update an error comment

Relevant code:

- `src/execution/executor.ts`
- `src/handlers/mention.ts`

## Common Reasons for "Eyes Reaction Happened But No Reply"

- Empty question after stripping the mention (handler skips)
- Publish did not occur (model did not call any comment tools); handler may post a fallback reply
- Comment publish API failed (execution may still finish, but tool call can error)
- Execution errored and an error comment failed to post (`Failed to post error comment`)

## Triage Matrix

- No GitHub delivery: GitHub-side misconfiguration or webhook not firing.
- Delivery exists, no ingress log: signature failure, wrong endpoint, or service unavailable.
- Ingress present, router matched 0 handlers: event key mismatch (wrong event/action).
- Router dispatched, handler skipped: mentions disabled, alias not accepted, or empty question.
- Processing mention logged, but no `Mention execution completed`: queue/executor failure; search for `Mention handler failed`.
- Inline thread mention replied top-level: event was `issue_comment.created` (PR top-level), not `pull_request_review_comment.created`.

## Code Pointers (Fast Navigation)

- Ingress + correlation: `src/routes/webhooks.ts`
- Router keys/dispatch: `src/webhook/router.ts`
- Mention handler: `src/handlers/mention.ts`
- Mention prompt rules (always reply; no tracking comment): `src/execution/mention-prompt.ts`
- Inline thread reply tool: `src/execution/mcp/review-comment-thread-server.ts`
- Top-level comment tool: `src/execution/mcp/comment-server.ts`

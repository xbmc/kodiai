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

Behavior today:

- If `write.enabled` is **false** (default), Kodiai will refuse to apply changes and will reply with a short message explaining how to enable write mode.
- In logs, expect a gate skip with:
  - `gate=write-mode`
  - `skipReason=write-disabled`

To enable for a repo, add to `.kodiai.yml`:

```yml
write:
  enabled: true
```

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

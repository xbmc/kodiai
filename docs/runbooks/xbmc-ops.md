# xbmc/xbmc Ops Runbook (Kodiai)

Use this runbook for day-2 operations on `xbmc/xbmc` after the cutover to the Kodiai GitHub App.

Primary goal: quickly decide whether a missing review/mention is an intentional skip, a publish/idempotency no-op, or a real failure, and gather the evidence needed to debug it.

Related runbooks:

- Mentions: `docs/runbooks/mentions.md`
- review_requested: `docs/runbooks/review-requested-debug.md`
- Cutover checklist: `docs/runbooks/xbmc-cutover.md`

## What Triggers Exist

Kodiai responds to these GitHub webhook events in `xbmc/xbmc`:

- PR auto-review:
  - `pull_request.opened`
  - `pull_request.ready_for_review`
  - `pull_request.review_requested` (manual re-request)
- Mentions:
  - PR top-level comment: `issue_comment.created` on a PR
  - Inline diff thread: `pull_request_review_comment.created`
  - Review body text: `pull_request_review.submitted`

Accepted mention handles:

- `@kodiai`
- `@claude` (alias; supported so maintainers can keep existing habits)

## Where To Look First (Fast Triage)

1) GitHub App Deliveries UI

- GitHub App Settings -> Advanced -> Recent Deliveries
- Find the delivery for the repo + event + action you triggered.
- Copy `X-GitHub-Delivery` (Kodiai logs this as `deliveryId`).

2) Application logs by deliveryId

Search logs for the exact delivery ID.

Expected log chain (high-level):

- `Webhook accepted and queued for dispatch`
- `Router evaluated dispatch keys`
- Either `Dispatched to ... handler(s)` or an explicit skip reason

If the delivery exists in GitHub but you cannot find the deliveryId in logs, suspect:

- Wrong webhook URL
- Signature/secret mismatch (HTTP 401)
- Service unavailability at delivery time

## "Skipped On Purpose" vs "Failed"

Treat these as common non-bugs:

- Mention text has no question after stripping the mention (e.g. `@claude` only)
- Mentions are disabled or alias not accepted by repo config
- `review_requested` was for a different reviewer/team (non-kodiai)
- Duplicate delivery was intentionally deduplicated
- Review output was intentionally suppressed due to idempotency
  - Example: the PR already contains the marker `<!-- kodiai:review-output-key:... -->`

Treat these as likely failures:

- Delivery exists but webhook returns non-200 (401/500)
- Handler started but no completion log appears
- Completion log exists but publish tool call failed (comment/review API error)

## Fork PR Behavior (Important for xbmc)

For fork PRs (and deleted-fork PRs), Kodiai intentionally does not try to clone the contributor fork.
Instead it clones the base repo and fetches the PR head ref from the base repo:

- Workspace strategy: base clone + `refs/pull/<n>/head` checkout
- Rationale: GitHub App tokens may not have reliable access to contributor forks; the base repo exposes the PR head ref for diffs.

If a fork PR fails in a way that looks like git authentication, confirm logs mention this strategy.
If logs show an attempt to clone `pr.head.repo`, treat that as a regression.

## review_requested Idempotency (What Replays Should Look Like)

Kodiai is designed to be safe under retries/redeliveries.

Expected:

- A replayed delivery should not produce duplicate review output.
- For the same identity, the handler should detect an existing review marker and log an "already published" skip.

If you see duplicate reviews/comments after a redelivery, gather:

- PR URL
- Delivery IDs for the original and replay
- The review/comment URLs that are duplicated

Then follow: `docs/runbooks/review-requested-debug.md`.

## Minimal Reproduction Templates (Copy/Paste)

Use these when you need a safe, deterministic trigger.

### A) Top-level PR comment mention

Post on the PR conversation tab:

```
@claude Please answer in one sentence: what is the intent of this PR?
```

Expected:

- Optional ":eyes:" reaction on the trigger comment (best-effort)
- A top-level reply comment from Kodiai

### B) Inline diff thread mention

Create an inline diff comment and include:

```
@claude Please summarize this change in one sentence.
```

Expected:

- Reply in the same inline thread

### C) Auto-review trigger (ready_for_review)

Open a draft PR and mark it ready.

Expected:

- A Kodiai review appears (may be APPROVE for doc-only/clean changes)

### D) Manual re-request (review_requested)

In the PR sidebar, request review from the Kodiai GitHub App.

Expected:

- A `pull_request` delivery with action `review_requested`
- Exactly one downstream execution and one output batch

## Evidence Checklist (What To Capture)

When reporting an incident, capture:

- PR URL
- Trigger comment URL (if mention-based)
- The exact mention text (copy/paste)
- Delivery ID (`X-GitHub-Delivery`)
- Outcome URLs:
  - review URL (if review)
  - reply comment URL (if mention)
- Any suspicious log snippet (especially skip reasons)

If you have the delivery ID, debugging can usually be finished quickly.

## Phase 74 Reliability Regression Gate

Pre-release command:

`bun run verify:phase74 --owner xbmc --repo xbmc --scenario <scenario-json>`

Treat this gate as release-blocking when any check fails.

### Capability preflight failures (`CAP-74-*`)

- `CAP-74-01` failed: runtime cannot satisfy branch creation prerequisites.
  - Check GitHub App/token permission level for `xbmc/xbmc` (must be write-capable).
  - Confirm repository is not archived and default branch resolves.
- `CAP-74-02` failed: bot branch push prerequisites are missing.
  - Check `permissions.push` visibility for runtime identity.
  - Confirm bot branch strategy is allowed for app installation.
- `CAP-74-03` failed: PR creation prerequisites are not available.
  - Resolve write/push permission gaps first, then rerun gate.

### Issue write-mode reliability failures (`REL-74-*`)

- `REL-74-01` failed: issue reply output is missing machine-checkable status line.
  - Ensure write failure/success replies include explicit `status:` marker.
- `REL-74-02` failed: failure was not pinned to expected step (`branch-push`, `create-pr`, `issue-linkback`).
  - Inspect publish logs for missing/incorrect `failed_step` mapping.
- `REL-74-03` failed: diagnostics were empty or non-actionable.
  - Ensure diagnostics include concrete cause or fallback `Unknown publish failure`.
- `REL-74-04` failed: status reported success without artifact triad.
  - Confirm branch push succeeded, PR URL exists, and issue linkback comment was posted.

### Combined degraded retrieval failures (`RET-74-*`)

- `RET-74-01` failed: rendered retrieval section exceeded max char budget.
  - Inspect retrieval rendering budget logic and bounded trimming behavior.
- `RET-74-02` failed: fallback output is not markdown-safe.
  - Inspect retrieval fallback sanitization for malformed backticks/formatting.

### Required evidence for escalation

When reporting a Phase 74 gate failure, include:

- Scenario JSON used for the run
- Full gate output with failed check IDs
- Delivery ID and issue/PR URLs tied to the scenario
- `status:` and `failed_step:` lines captured from issue write reply

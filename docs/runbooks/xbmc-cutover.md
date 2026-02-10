# xbmc/xbmc Cutover Runbook (Kodiai GitHub App)

Use this runbook to cut over `xbmc/xbmc` from the `@claude` GitHub Actions workflow to the **Kodiai GitHub App**.

Goal: webhooks deliver successfully to Kodiai, and maintainers can keep using `@claude` (alias) for both top-level PR comments and inline diff threads.

## Quick Checklist

- [ ] Install the Kodiai GitHub App on `xbmc/xbmc` (or the xbmc org with repo access)
- [ ] Verify repository permissions and subscribed webhook events
- [ ] Ensure webhook URL is configured: `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github`
- [ ] Confirm at least one successful delivery (HTTP 200) in the GitHub App deliveries UI
- [ ] Run smoke tests (mentions + auto-review + manual re-request)
- [ ] Disable/remove the legacy `@claude` GitHub Actions workflow (to avoid double-processing)

## 1) Required GitHub App Permissions (Repository Permissions)

In the GitHub App settings, ensure these permissions are granted (at least) for `xbmc/xbmc`:

- **Contents:** Read & write
- **Issues:** Read & write
- **Pull requests:** Read & write
- **Actions:** Read-only
- **Metadata:** Read-only
- **Checks:** Read-only

Why these matter (high level):

- **Issues / Pull requests (write):** required to post comments/replies and reviews.
- **Contents (write):** used by the review executor when it needs to read content and/or create review artifacts.
- **Metadata (read):** baseline repo access.
- **Checks / Actions (read):** used for review context and CI signal gathering.

## 2) Required Webhook Events (Subscriptions)

Ensure the app is subscribed to these events:

- `issue_comment`
- `issues`
- `pull_request`
- `pull_request_review`
- `pull_request_review_comment`

These cover:

- PR top-level `@claude ...` mentions (`issue_comment.created` on PRs)
- Inline diff thread mentions (`pull_request_review_comment.created`)
- PR open/synchronize/reopen events (auto-review triggers)
- Review body mention surface (`pull_request_review.submitted`)
- Manual reviewer re-request (`pull_request.review_requested`)

## 3) Webhook URL + Expected HTTP Response Semantics

Webhook URL (must end with `/webhooks/github`):

`https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github`

Expected response behavior:

- **Valid signature:** HTTP `200` with body `{ "received": true }`
- **Invalid or missing signature:** HTTP `401` (delivery shown as failed)

Notes:

- Deliveries should include an `X-GitHub-Delivery` header; Kodiai logs and correlates work by this `deliveryId`.
- A `200` response indicates the webhook was accepted; it does not guarantee downstream job execution succeeded.

## 4) Confirm Deliveries in GitHub (UI)

Preferred: GitHub App UI

1) GitHub App Settings -> **Advanced** -> **Recent Deliveries**
2) Filter/look for deliveries from `xbmc/xbmc`
3) Confirm:
   - The delivery shows **HTTP 200**
   - Headers include `X-GitHub-Delivery`
   - The payload `event`/`action` matches what you triggered (examples below)

Optional (requires `gh` token scopes; often needs `admin:repo_hook`):

- See `docs/runbooks/mentions.md` and `docs/runbooks/review-requested-debug.md` for `gh api .../hooks/.../deliveries` examples.

## 5) Smoke Tests (End-to-End)

Run these on a small test PR in `xbmc/xbmc`.

### A) Top-level PR comment mention (uses alias)

1) On the PR conversation tab, add a comment:
   - `@claude What is this PR doing at a high level?`
2) Expected:
   - An ":eyes:" reaction may appear on the trigger comment (best-effort; non-blocking)
   - Kodiai posts a top-level reply comment on the PR with an answer
3) In deliveries UI, expect an `issue_comment` event with action `created`.

### B) Inline diff thread mention (uses alias)

1) Add an inline review comment on a specific line in the PR diff:
   - `@claude Why is this change needed here?`
2) Expected:
   - Kodiai replies **in the same inline thread** (not as a top-level PR comment)
3) In deliveries UI, expect a `pull_request_review_comment` event with action `created`.

If the reply shows up top-level instead of in-thread, cross-check the delivery event type.

### C) Auto-review on PR open/update

1) Open a new PR (or push a new commit to an existing PR).
2) Expected:
   - Kodiai posts a PR review (inline comments and/or a summary) depending on findings
3) In deliveries UI, expect `pull_request` events (e.g. `opened`, `synchronize`).

### D) Manual review re-request triggers exactly one run

1) Remove Kodiai as a reviewer (if present).
2) Re-request review from Kodiai.
3) Expected:
   - Exactly one `pull_request` event with action `review_requested` for that re-request
   - Exactly one downstream run (no duplicates)

If re-request does not trigger, use: `docs/runbooks/review-requested-debug.md`.

## 6) Cutover: Disable the Legacy @claude GitHub Actions Workflow

To avoid double-processing (Actions + App), disable or remove the existing `@claude` GitHub Actions workflow in `xbmc/xbmc`.

Suggested approach:

- Disable the workflow in the GitHub UI, or delete the workflow file (if it is safe to do so).

After disabling:

- Re-run smoke test A and ensure the only automation responding is Kodiai (via the app).

## 7) Troubleshooting Pointers

- Mention problems: `docs/runbooks/mentions.md`
- review_requested problems: `docs/runbooks/review-requested-debug.md`
- If deliveries show 401: suspect webhook secret/signature mismatch or wrong endpoint.

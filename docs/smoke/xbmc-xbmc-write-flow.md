Smoke Test: xbmc/xbmc write-mode end-to-end

Goal

Validate the full mention-driven write flow in a real xbmc/xbmc PR using:
- `plan:` (plan-only)
- `apply:` (write-mode)

Confirm these behaviors:
1) Same-repo PR => updates the PR head branch
2) Fork PR => bot PR fallback
3) Guardrails refuse denied paths and secret-like content
4) Evidence bundle logs are emitted and easy to grep by deliveryId

Pre-reqs

- The `kodiai` GitHub App is installed on `xbmc/xbmc`.
- `.kodiai.yml` in `xbmc/xbmc` has write-mode enabled for the test branch/PR.
- You know how to access the GitHub App deliveries UI (to copy `X-GitHub-Delivery`).

How to capture the deliveryId

1) Open GitHub App Settings -> Advanced -> Recent Deliveries
2) Find the delivery for the repo + event:
   - `issue_comment` action `created` (PR top-level comment), OR
   - `pull_request_review_comment` action `created` (inline diff comment)
3) Copy the `X-GitHub-Delivery` value

How to find the evidence bundle log

Search application logs for the deliveryId and for the structured line:

- Message: `Evidence bundle`
- Fields include:
  - `evidenceType=write-mode`
  - `outcome=updated-pr-branch|created-pr|reused-pr|skipped-idempotent`
  - `deliveryId=<X-GitHub-Delivery>`

Same-repo PR: branch update path

Setup

- Use a PR where the head branch is in `xbmc/xbmc` (not a fork).
- Add a tiny, safe change (e.g. a one-line comment or whitespace in a docs file).

Steps

1) Comment:
   - `@kodiai plan: <describe the tiny change>`
2) Confirm you get a plan (no writes).
3) Comment:
   - `@kodiai apply: <same tiny change>`
4) Confirm the PR branch is updated (new commit on the PR head branch).
5) Capture:
   - PR URL
   - trigger comment URL
   - commit SHA on the PR
   - deliveryId and the evidence bundle log line

Expected

- Evidence bundle outcome: `updated-pr-branch`
- The PR is not replaced by a new bot PR

Fork PR: bot PR fallback path

Setup

- Use a PR where the head branch is in a fork.
- Keep the change tiny and safe (same shape as above).

Steps

1) Comment:
   - `@kodiai plan: <describe the tiny change>`
2) Comment:
   - `@kodiai apply: <same tiny change>`
3) Confirm the bot opens a new PR in `xbmc/xbmc` from a `kodiai/apply/...` branch.
4) Capture:
   - source PR URL
   - bot PR URL
   - deliveryId and the evidence bundle log line

Expected

- Evidence bundle outcome: `created-pr` (or `reused-pr` if re-run)

Guardrails: denied path refusal

Setup

- Use any PR with write-mode enabled.

Steps

1) Comment:
   - `@kodiai apply: make a tiny change in .github/workflows/...`
2) Confirm refusal.
3) Capture deliveryId and refusal body.

Expected

- Refusal includes:
  - the file/path involved
  - the rule/reason code
  - a conservative suggestion (or explicitly says no safe suggestion)

Guardrails: secret-like content refusal

Steps

1) Comment:
   - `@kodiai apply: add a fake token-like string to a test file`
2) Confirm refusal.
3) Capture deliveryId and refusal body.

Expected

- Refusal includes:
  - file/path (best-effort)
  - detector name (regex vs entropy)
  - the rule/reason code
  - guidance to remove/redact the content (no config bypass suggested as the default)

Notes

- Keep the change minimal and reversible.
- Do not paste real secrets into PRs.

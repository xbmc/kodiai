Smoke Test: xbmc/kodiai write-mode end-to-end

Goal

Validate the full mention-driven write flow in the default repo (`xbmc/kodiai`) using:

- `plan:` (plan-only)
- `apply:` (write-mode)

Confirm these behaviors:

1) Same-repo PR => updates the PR head branch
2) Fork PR => bot PR fallback
3) Guardrails refuse denied paths and secret-like content
4) Evidence bundle logs are emitted and easy to grep by deliveryId

Why xbmc/kodiai first

`xbmc/kodiai` is the safest and fastest place to validate:

- GitHub App permissions are known-good
- CI and configs are under our control
- It avoids touching xbmc/xbmc unless required

Pre-reqs

- The `kodiai` GitHub App is installed on `xbmc/kodiai`.
- `.kodiai.yml` in the PR branch enables write-mode for the smoke paths you intend to change.
- You can access the GitHub App deliveries UI (to copy `X-GitHub-Delivery`).

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
  - `"evidenceType": "write-mode"`
  - `"outcome": "updated-pr-branch|created-pr|reused-pr|skipped-idempotent"`
  - `"deliveryId": "<X-GitHub-Delivery>"`

Same-repo PR: branch update path

Setup

- Create a PR from a branch in `xbmc/kodiai` (not a fork).
- Make a tiny, safe change (e.g. add a line to a docs file).

Steps

1) Comment:
   - `@kodiai plan: <describe the tiny change>`
2) Confirm you get a plan (no writes).
3) Comment:
   - `@kodiai apply: <same tiny change>`
4) Confirm the PR head branch gets a new commit (no bot PR fallback).

Expected

- Evidence bundle outcome: `updated-pr-branch`

Fork PR: bot PR fallback path

Setup

- Open a PR from a fork (e.g. `your-user/kodiai` -> `xbmc/kodiai`).
- Keep the change tiny and safe.

Steps

1) Comment:
   - `@kodiai plan: <describe the tiny change>`
2) Comment:
   - `@kodiai apply: <same tiny change>`
3) Confirm the bot opens a new PR in `xbmc/kodiai` from a `kodiai/apply/...` branch.

Expected

- Evidence bundle outcome: `created-pr` (or `reused-pr` if re-run)

Guardrails: denied path refusal

Steps

1) Comment:
   - `@kodiai apply: make a tiny change in .github/workflows/...`
2) Confirm refusal.

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

Expected

- Refusal includes:
  - file/path (best-effort)
  - detector name (regex vs entropy)
  - the rule/reason code
  - guidance to remove/redact the content (no config bypass suggested as the default)

Escalation: when xbmc/xbmc is necessary

Only run the same smoke steps in `xbmc/xbmc` if the behavior depends on:

- repo size/perf (timeouts, clone strategy)
- permissions unique to xbmc/xbmc
- configs that differ materially from xbmc/kodiai

Smoke marker: reviewer api behavior check.

# S02: Live proof and auditability verification — UAT

**Milestone:** M049
**Written:** 2026-04-13T15:47:55.959Z

# UAT — M049/S02 Live proof and auditability verification

## Preconditions

- The repo has Bun dependencies installed.
- GitHub App credentials are available to `bun run` and the app has read access to PR reviews/review comments for the target repo.
- Azure Log Analytics access is configured for the verifier environment, or the operator intentionally wants to observe the truthful unavailable-state contract.
- You have at least one freshly published **explicit clean** `reviewOutputKey` whose action is `mention-review`.

## Test Case 1 — Successful explicit clean-approval proof

1. Capture a fresh explicit clean approval `reviewOutputKey` from an `@kodiai review` run on `xbmc/kodiai` that published a clean approval.
   - **Expected:** The key is in the `kodiai-review-output:v1:...:action-mention-review:...` format and points at the same repo/PR you plan to verify.
2. Run:
   - `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <fresh-key> --json`
   - **Expected:** Command exits 0.
3. Inspect the JSON report.
   - **Expected:** `status_code` is `m049_s02_ok`.
   - **Expected:** `artifactCounts.reviewComments = 0`, `artifactCounts.issueComments = 0`, `artifactCounts.reviews = 1`, `artifactCounts.total = 1`.
   - **Expected:** `artifact.source` is `review`, `artifact.reviewState` is `APPROVED`, and `artifact.sourceUrl` is a GitHub review URL.
   - **Expected:** `bodyContract.valid = true`, `hasDecisionApprove = true`, `hasIssuesNone = true`, `hasEvidenceHeading = true`, `hasOnlyEvidenceBullets = true`, `evidenceBulletCount` is between 1 and 3, and `hasExactMarker = true`.
   - **Expected:** `audit.publishResolution` is one of `approval-bridge`, `idempotency-skip`, or `duplicate-suppressed`.
4. Open the returned `artifact.sourceUrl` on GitHub.
   - **Expected:** Operators can see the same visible clean approval body with `Decision: APPROVE`, `Issues: none`, and `Evidence:` bullets directly on the PR review surface, with no separate clean-approval issue comment required.

## Test Case 2 — Reject non-explicit keys before live lookup

1. Use a syntactically valid `reviewOutputKey` whose action is not `mention-review` (for example `review_requested` or `synchronize`).
2. Run:
   - `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <non-explicit-key> --json`
   - **Expected:** Command exits non-zero.
   - **Expected:** `status_code` is `m049_s02_invalid_arg`.
   - **Expected:** `issues[]` includes `--review-output-key must encode the explicit mention-review action.`
   - **Expected:** No live GitHub scan is attempted.

## Test Case 3 — Reject repo/key mismatches before live lookup

1. Use a valid explicit `reviewOutputKey` for `xbmc/kodiai`.
2. Run:
   - `bun run verify:m049:s02 -- --repo xbmc/other-repo --review-output-key <xbmc-kodiai-key> --json`
   - **Expected:** Command exits non-zero.
   - **Expected:** `status_code` is `m049_s02_invalid_arg`.
   - **Expected:** `issues[]` includes `Provided --repo does not match the repository encoded in --review-output-key.`

## Test Case 4 — Truthful degradation when GitHub or Azure access is unavailable

1. Run the verifier in an environment where GitHub App read access or Azure workspace access is intentionally unavailable.
   - Example:
     - `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <explicit-key> --json`
2. Inspect the JSON report.
   - **Expected:** Command exits non-zero with one of the named unavailable statuses: `m049_s02_missing_github_access`, `m049_s02_github_unavailable`, `m049_s02_azure_unavailable`, or `m049_s02_audit_unavailable`.
   - **Expected:** `preflight.githubAccess` / `preflight.azureAccess` truthfully reflect availability.
   - **Expected:** The report does **not** fabricate a passing artifact or publish resolution.
   - **Expected:** `issues[]` clearly explains which dependency was unavailable.

## Edge Cases

### Edge Case A — Duplicate visible outputs

1. Use fixture-driven verification (`bun test ./scripts/verify-m049-s02.test.ts`) or a controlled repro environment where the same explicit `reviewOutputKey` appears on more than one GitHub surface.
   - **Expected:** The proof path lands on `m049_s02_duplicate_visible_outputs` instead of falsely accepting the latest artifact.

### Edge Case B — Body drift or wrong review state

1. Use fixture-driven verification (`bun test ./src/review-audit/review-output-artifacts.test.ts ./scripts/verify-m049-s02.test.ts`) with a sole matching artifact whose state is not `APPROVED` or whose body no longer matches the shared APPROVE grammar.
   - **Expected:** The verifier reports `m049_s02_wrong_review_state` or `m049_s02_body_drift` and exposes the relevant `bodyContract` booleans / issues for debugging.

---
estimated_steps: 5
estimated_files: 3
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T02: Build the live M049/S02 verifier command

**Slice:** S02 — Live proof and auditability verification
**Milestone:** M049

## Description

Build the live `verify:m049:s02` command that consumes the new GitHub artifact helper, reuses the existing GitHub App / Azure Log Analytics access patterns, and emits truthful machine/human proof for one explicit clean `@kodiai review` artifact. Keep this verifier read-only: it must inspect live GitHub/Azure state, never publish or mutate GitHub surfaces.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| GitHub App credentials / installation lookup | Return a named missing-GitHub-access status and stop before any proof claim. | Treat auth/installation timeouts as unavailable GitHub access, not a pass. | Reject repo parsing / installation mismatches before querying live artifacts. |
| GitHub review/comment artifact collection | Return named `no_matching_artifact`, `duplicate_visible_outputs`, `wrong_surface`, or `wrong_review_state` failures instead of broad success. | Keep the command read-only and fail closed when artifact collection does not finish. | Treat missing body, URL, marker, or state on a matching artifact as body/state drift rather than ignoring it. |
| Azure Log Analytics workspace discovery and query | Return `azure_unavailable` / `audit_unavailable` style failures and preserve GitHub proof fields for debugging. | Never treat query timeout as correlated success. | Treat missing or unknown `publishResolution` values as audit-correlation failure rather than defaulting to clean. |

## Load Profile

- **Shared resources**: GitHub App installation token, GitHub review/comment list endpoints, and Azure Log Analytics workspace query quota.
- **Per-operation cost**: one PR-scoped GitHub artifact scan plus one Azure query filtered by `reviewOutputKey` + delivery id.
- **10x breakpoint**: repeated verifier runs or overly broad queries hit API/log quotas first; keep queries scoped to one parsed PR/key pair and never enumerate extra PRs.

## Negative Tests

- **Malformed inputs**: missing `--review-output-key`, invalid key grammar, non-explicit action, and repo mismatch when `--repo` disagrees with the encoded key.
- **Error paths**: missing GitHub creds/install access, zero artifact matches, duplicate visible outputs, Azure workspace discovery/query failure, and missing or non-clean `publishResolution` evidence.
- **Boundary conditions**: exactly one matching `APPROVED` review success, one matching review with the wrong state, one matching issue comment or review comment, and clean idempotent resolutions (`approval-bridge`, `idempotency-skip`, `duplicate-suppressed`) all accepted.

## Steps

1. Add `scripts/verify-m049-s02.test.ts` first to pin CLI parsing, named status codes, wrong-lane rejection, missing GitHub access, no-match / duplicate / wrong-surface / wrong-review-state / body-contract drift / audit-correlation failure branches, and the success report shape.
2. Implement `scripts/verify-m049-s02.ts` using the GitHub App env-loading + repo parsing pattern from `scripts/verify-m044-s01.ts`, but require `--review-output-key` and reject any parsed action other than `mention-review`.
3. Join the GitHub artifact result to Azure log evidence with `queryReviewAuditLogs(...)` and `buildExplicitLaneEvidenceFromLogs(...)`, treating `approval-bridge`, `idempotency-skip`, and `duplicate-suppressed` as clean audit resolutions while keeping missing Azure access or correlation drift as named failures instead of silent passes.
4. Render both human and JSON output with the operator-facing review URL, artifact counts by surface, review state, body-contract verdicts, publish resolution, and `issues[]`, then wire `package.json` to `verify:m049:s02`.
5. Re-run the focused verifier tests plus `bun run tsc --noEmit`, keeping the command read-only and ready for a fresh live proof run with a real explicit clean `reviewOutputKey`.

## Must-Haves

- [ ] `verify:m049:s02` requires `--review-output-key`, accepts `--repo` and `--json`, and rejects non-explicit keys before any live lookup.
- [ ] Success only occurs when GitHub proves exactly one visible artifact, that artifact is an `APPROVED` review with the shared visible body, and Azure logs correlate the same key to a clean explicit publish resolution.
- [ ] Failures degrade truthfully with stable named status codes for GitHub access gaps, missing/multiple artifacts, wrong surface/state, body drift, and audit unavailability/correlation mismatch.

## Verification

- `bun test ./scripts/verify-m049-s02.test.ts ./src/review-audit/evidence-correlation.test.ts`
- `bun run tsc --noEmit`
- Confirm the success report carries the review URL, per-surface counts, body-contract verdicts, and Azure publish-resolution fields needed for the final live proof run.

## Observability Impact

- Signals added/changed: the verifier reports GitHub access state, per-surface artifact counts, review URL/state, body-contract checks, Azure source availability, and explicit `publishResolution` under one report.
- How a future agent inspects this: run `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <key> --json` and inspect the returned `status_code`, `issues`, `artifactCounts`, `artifact.sourceUrl`, and audit correlation fields.
- Failure state exposed: missing GitHub credentials, missing Azure workspaces, duplicate visible outputs, wrong artifact surface/state, body drift, and audit mismatch each resolve to named failure states instead of a generic false-green result.

## Inputs

- `src/review-audit/review-output-artifacts.ts` — exact-match GitHub artifact collector and body validator produced by T01.
- `src/review-audit/review-output-artifacts.test.ts` — helper-level contract coverage that should remain green while the verifier integrates it.
- `scripts/verify-m044-s01.ts` — existing GitHub App env-loading and live Octokit access pattern to reuse rather than shelling out to `gh`.
- `scripts/verify-m044-s01.test.ts` — established report/test shape for truthful live-access degradation.
- `scripts/verify-m048-s01.ts` — current reviewOutputKey-driven Azure verifier pattern, including stable status-code and output-shape conventions.
- `scripts/verify-m048-s01.test.ts` — regression examples for named invalid-arg and live-evidence behaviors.
- `src/review-audit/evidence-correlation.ts` — existing explicit-lane `publishResolution` interpretation helper.
- `src/review-audit/evidence-correlation.test.ts` — regression coverage for clean explicit audit resolutions.
- `src/review-audit/log-analytics.ts` — Azure workspace discovery and query helpers.
- `package.json` — script entrypoints that must expose `verify:m049:s02`.

## Expected Output

- `scripts/verify-m049-s02.ts` — read-only live verifier for explicit clean approvals keyed by `reviewOutputKey`.
- `scripts/verify-m049-s02.test.ts` — CLI/status/report regression coverage for GitHub uniqueness, body proof, and Azure audit correlation.
- `package.json` — `verify:m049:s02` script wired to the new verifier.

---
id: S02
parent: M049
milestone: M049
provides:
  - An exact PR-scoped `reviewOutputKey` artifact collector and shared visible APPROVE body validator for one explicit clean approval.
  - A read-only `verify:m049:s02` operator verifier that joins GitHub-visible approval proof to Azure explicit-lane publish-resolution evidence.
  - Stable operator-facing status codes for missing/unavailable GitHub access, duplicate or wrong-surface/state artifacts, body drift, and Azure audit mismatches.
requires:
  - slice: S01
    provides: The shared visible clean-approval body grammar, `reviewOutputKey` marker contract, and publisher behavior that S02 validates live.
affects:
  []
key_files:
  - src/review-audit/review-output-artifacts.ts
  - src/review-audit/review-output-artifacts.test.ts
  - scripts/verify-m049-s02.ts
  - scripts/verify-m049-s02.test.ts
  - package.json
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D118 — Add a dedicated explicit-lane live verifier that combines exact `reviewOutputKey` artifact collection/body validation with existing Azure publish-resolution correlation instead of widening publisher handlers.
  - D119 — Map low-level invalid artifact metadata into the stable operator-facing wrong-review-state/body-drift status surface while preserving raw artifact and body-contract details.
patterns_established:
  - Keep exact `reviewOutputKey` proof logic separate from latest-only retrospective audit samplers so duplicate or wrong-surface artifacts cannot be collapsed away.
  - Reject malformed, repo-mismatched, or non-`mention-review` keys before any live GitHub lookup so stale or attacker-supplied keys cannot steer the verifier at the wrong PR.
  - Fail closed with stable named statuses while still surfacing raw `artifact`, `artifactCounts`, `bodyContract`, and Azure audit fields for debugging.
observability_surfaces:
  - `bun run verify:m049:s02 -- --json` exposes `status_code`, `preflight`, per-surface `artifactCounts`, `artifact` metadata, `bodyContract` booleans, audit availability, `publishResolution`, and `issues[]`.
  - `scripts/verify-m049-s02.test.ts` pins success plus named GitHub/Azure failure branches, including wrong surface/state, body drift, Azure unavailable, and audit mismatch.
  - `src/review-audit/review-output-artifacts.test.ts` proves exact per-surface counting and metadata preservation so the live verifier can distinguish duplicates from missing artifacts instead of sampling only the newest PR artifact.
drill_down_paths:
  - .gsd/milestones/M049/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M049/slices/S02/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-13T15:47:55.959Z
blocker_discovered: false
---

# S02: Live proof and auditability verification

**Added exact review-output artifact proof helpers and the read-only `verify:m049:s02` verifier so explicit clean approvals can be counted, body-validated, and Azure-correlated with stable failure states instead of latest-only sampling or silent access drift.**

## What Happened

# S02: Live proof and auditability verification

**Added an exact `reviewOutputKey` artifact collector plus the read-only `verify:m049:s02` explicit clean-approval verifier, proving the code/test contract and observability surfaces while failing closed with named statuses when GitHub or Azure access is unavailable.**

## What Happened

## Delivered

- `src/review-audit/review-output-artifacts.ts` now provides a dedicated PR-scoped collector that preserves **every** matching review comment, issue comment, and review for one requested `reviewOutputKey` instead of reusing the latest-only sampling logic from `recent-review-sample.ts`.
- That same module added `validateVisibleApproveReviewBody(...)` and `evaluateExactReviewOutputProof(...)`, which deterministically distinguish missing artifacts, duplicate visible outputs, wrong surface, wrong review state, invalid metadata, and visible-body drift for the shared APPROVE contract from S01.
- `scripts/verify-m049-s02.ts` now wires a new operator entrypoint, `bun run verify:m049:s02`, around those helpers. The command rejects malformed keys, rejects non-explicit `action=mention-review` mismatches before live access, scopes GitHub reads to the repo/PR encoded in the key, and joins successful GitHub proof to Azure explicit-lane evidence via the existing log-analytics/evidence-correlation seams.
- The verifier exposes both JSON and human-readable reports with the required observability fields: `status_code`, per-surface `artifactCounts`, visible artifact metadata (`sourceUrl`, `reviewState`, lane/action), shared-body booleans, Azure source availability, matched row counts, `publishResolution`, and `issues[]`.
- T02 also recorded D119 so low-level metadata failures stay mapped into the stable operator-facing `wrong_review_state` / `body_drift` status surface without throwing away the raw artifact/body-contract details, and closeout added a `.gsd/KNOWLEDGE.md` entry documenting why exact `reviewOutputKey` proof must stay separate from latest-only audit samplers.

## What the slice actually proved

Fresh closeout verification proved the implementation contract completely in code:

- the exact collector preserves per-surface counts and metadata for one `reviewOutputKey` rather than silently collapsing to the newest PR artifact;
- the proof helper accepts only one sole visible `APPROVED` review on the `review` surface with the shared `Decision: APPROVE` / `Issues: none` / `Evidence:` body and exact marker;
- duplicate outputs, wrong-surface issue/review comments, wrong review state, invalid metadata, and body drift all land on stable named failure statuses;
- the verifier success path accepts only clean explicit publish resolutions (`approval-bridge`, `idempotency-skip`, `duplicate-suppressed`);
- and GitHub/Azure access failures degrade truthfully instead of fabricating a successful proof.

The fresh runtime command from this environment did **not** produce a successful live approval proof. Running `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101 --json` failed closed with `status_code: "m049_s02_github_unavailable"` after GitHub returned 403 from `GET /repos/xbmc/kodiai/pulls/101/comments`. That result still verified the intended observability surface — stable status code, empty artifact counts, preflight access state, and issues array — but it means this auto-mode closeout could only prove the verifier and truthful degradation path, not a fresh production `m049_s02_ok` run against a newly published explicit clean approval.

## Operational Readiness (Q8)

- **Health signal:** `bun run verify:m049:s02 -- --repo <owner/repo> --review-output-key <explicit-clean-key> --json` returns `m049_s02_ok` with `artifactCounts = { reviewComments: 0, issueComments: 0, reviews: 1, total: 1 }`, `artifact.source = "review"`, `artifact.reviewState = "APPROVED"`, all shared-body booleans true, and Azure `publishResolution` set to `approval-bridge`, `idempotency-skip`, or `duplicate-suppressed`.
- **Failure signal:** any of `m049_s02_missing_github_access`, `m049_s02_github_unavailable`, `m049_s02_no_matching_artifact`, `m049_s02_duplicate_visible_outputs`, `m049_s02_wrong_surface`, `m049_s02_wrong_review_state`, `m049_s02_body_drift`, `m049_s02_azure_unavailable`, `m049_s02_audit_unavailable`, or `m049_s02_audit_mismatch`.
- **Recovery procedure:** restore GitHub App read access for PR review artifacts and Azure Log Analytics access, capture a fresh explicit clean-approval `reviewOutputKey` from `xbmc/kodiai`, rerun `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <fresh-key> --json`, and inspect the returned review URL plus publish-resolution fields before milestone validation.
- **Monitoring gaps:** milestone-close operational proof still needs one accessible fresh explicit clean approval key; current automation can prove the verifier contract and named failure surfaces, but not a live `m049_s02_ok` publication from this environment.

## Requirements

- **Advanced:** R043 — the explicit mention-review lane now has an operator verifier that can prove “exactly one visible GitHub outcome” using exact per-surface counts, shared-body validation, and Azure publish-resolution correlation instead of latest-only artifact sampling.
- **Validated:** None in this closeout. The code/test contract is complete, but a fresh accessible live run is still required before claiming new production validation evidence for R043.
- **New requirements surfaced:** None.
- **Requirements invalidated or re-scoped:** None.

## Deviations

A fresh live `m049_s02_ok` proof could not be captured in this auto-mode environment because GitHub returned 403 during review-comment collection before artifact proof or Azure correlation could proceed. The slice therefore closed on complete code/test verification plus truthful runtime degradation evidence rather than a successful production verification run.

## Known Limitations

Milestone validation still needs a fresh explicit clean approval `reviewOutputKey` from a repo where the configured GitHub App can read PR review artifacts and the verifier can reach Azure workspaces. Until that run is captured, the operator proof surface is shipped and tested, but its success path remains unproven from this environment.

## Follow-ups

Capture a fresh explicit clean-approval key on `xbmc/kodiai`, rerun `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <fresh-key> --json`, and use the returned review URL plus Azure `publishResolution` evidence during M049 milestone validation.

## Verification

- `bun test ./src/review-audit/review-output-artifacts.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m049-s02.test.ts` — passed fresh at slice close (30 pass, 0 fail).
- `bun run tsc --noEmit` — passed fresh at slice close (exit 0).
- `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101 --json` — ran fresh and failed closed with `status_code: "m049_s02_github_unavailable"` after GitHub returned 403 while listing PR review comments; this verified the named degradation path and report shape, but not a successful live explicit clean-approval proof.
- Observability surface reverified: the live verifier emitted the expected `status_code`, `preflight`, `artifactCounts`, `audit`, and `issues[]` fields, while the focused helper/verifier tests pinned duplicate, wrong-surface, wrong-state, body-drift, Azure-unavailable, audit-unavailable, and audit-mismatch statuses.

## Requirements Advanced

- R043 — Added exact per-surface artifact counting and the `verify:m049:s02` operator verifier so explicit clean approvals can be proven as one visible `APPROVED` review with Azure publish-resolution correlation when access is available.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

A fresh live success proof was not obtainable from this environment: the shipped verifier executed, but GitHub returned 403 while listing PR review comments, so closeout verified the truthful unavailable-state path rather than a successful `m049_s02_ok` run.

## Known Limitations

The shipped verifier success path still needs one fresh explicit clean approval key plus working GitHub/Azure access to capture final production evidence for milestone validation. Current closeout proves the helper/verifier contract and named degradation surfaces, not a successful live approval audit from this environment.

## Follow-ups

Rerun `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <fresh-key> --json` once GitHub App review-artifact access and Azure workspace access are available, then use the returned review URL and `publishResolution` evidence when validating M049.

## Files Created/Modified

- `src/review-audit/review-output-artifacts.ts` — Added the exact per-surface collector, shared APPROVE-body contract validator, and proof evaluator for one requested `reviewOutputKey`.
- `src/review-audit/review-output-artifacts.test.ts` — Pinned exact count preservation, metadata handling, duplicate/wrong-surface/state branches, and visible-body drift behavior.
- `scripts/verify-m049-s02.ts` — Added the read-only explicit clean-approval verifier, CLI parsing/preflight validation, GitHub/Azure correlation, and JSON/human report rendering.
- `scripts/verify-m049-s02.test.ts` — Pinned the verifier contract for invalid args, success, named proof failures, and truthful Azure/GitHub degradation paths.
- `package.json` — Registered `verify:m049:s02` as the operator entrypoint for this slice.
- `.gsd/KNOWLEDGE.md` — Recorded that exact `reviewOutputKey` proof must stay separate from latest-only audit sampling helpers.

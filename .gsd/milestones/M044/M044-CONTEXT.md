---
depends_on: [M043]
---

# M044: Audit Recent XBMC Review Correctness

**Gathered:** 2026-04-08
**Status:** Queued — pending auto-mode execution.

## Project Description

Retrospectively audit the most recent ~12 Kodiai-reviewed pull requests on `xbmc/xbmc` across both automatic PR review and explicit `@kodiai review` lanes. Determine which approval-only outcomes were genuinely clean reviews, which hid missed or unpublished findings, fix any production logic defects the audit exposes, and finish with a repeatable audit/verification surface that operators can rerun later without manual PR-by-PR archaeology.

## Why This Milestone

The user observed a suspicious pattern in recent `xbmc/xbmc` reviews: Kodiai appears to approve everything, and the only visible output is often the `Review Details` block. Current code shows that this pattern is **sometimes correct** — a clean review can legitimately publish a silent approval plus Review Details only — so GitHub alone is ambiguous. M043 repaired one broken publication path for explicit review publication, but it did not prove that the recent body of real `xbmc/xbmc` reviews is trustworthy. This milestone closes that gap by auditing recent live output against Kodiai’s own publication signals and fixing any defects that the audit uncovers.

## User-Visible Outcome

### When this milestone is complete, the user can:

- run one repeatable audit over the recent `xbmc/xbmc` Kodiai-reviewed PRs and get a truthful per-PR verdict instead of guessing from approvals alone.
- distinguish valid clean approvals from missed or unpublished findings using documented evidence, then trust the recent review stream or act on the exact failures.

### Entry point / environment

- Entry point: operator audit command / verification script plus GitHub PR threads and Kodiai production debug surfaces.
- Environment: production-like, read-only inspection of live GitHub state and live Kodiai publication evidence.
- Live dependencies involved: GitHub PR review/comment surfaces, Azure Container Apps console logs / runbooks, Kodiai production deployment.

## Completion Class

- Contract complete means: the audit surface classifies recent reviews using explicit rules for `clean-valid`, `findings-published`, `publish-failure`, `suspicious-approval`, and truthful `indeterminate` outcomes.
- Integration complete means: the audit correlates GitHub-visible output with Kodiai’s existing `reviewOutputKey`, idempotency, and publish-state signals across both automatic review and explicit mention review lanes.
- Operational complete means: the recent `xbmc/xbmc` sample has been audited end to end, any surfaced production defect has been fixed, and the verifier can be rerun later without rediscovering the audit method.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- a recent sample of approximately twelve `xbmc/xbmc` Kodiai-reviewed PRs can be audited with a deterministic selection rule and each PR receives a truthful verdict backed by both GitHub-visible output and internal publication evidence.
- approval-only reviews that are genuinely clean stay classified as valid rather than false positives, with evidence tied to the actual review lane that produced them.
- at least one known failure-shaped path is distinguishable from a clean approval by the verifier, so the milestone does not just rubber-stamp every approval-only review as healthy.
- the production-facing audit result depends on real GitHub PR history and live publication signals; this part cannot be simulated away if the milestone is to be considered done.

## Risks and Unknowns

- Clean approval + Review Details only is a valid shipped behavior on some review paths — misclassifying those as failures would create a noisy and untrustworthy audit.
- Automatic review and explicit `@kodiai review` use different publication paths and different terminal signals — the audit must not collapse them into one generic success/failure model.
- Recent PR discovery may be noisy if based on GitHub text search alone — the sample-selection rule must be explicit and repeatable.
- Production evidence availability may vary (GitHub output present, internal logs missing, or vice versa) — the audit needs an explicit `indeterminate` class rather than overstated verdicts.
- If the audit finds wrong approvals, the fix may live in publication, output classification, or review generation logic; the milestone cannot assume the root cause in advance.

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — **verified against current codebase state**. The automatic PR review handler can legitimately publish a silent approval with no summary comment, then post standalone `Review Details` when `result.published === false`; findings publication and approval submission are separate paths.
- `src/handlers/mention.ts` — **verified against current codebase state**. Explicit `@kodiai review` uses a distinct approval bridge with terminal `publishResolution` states such as `approval-bridge`, `idempotency-skip`, `duplicate-suppressed`, and publish-failure fallbacks.
- `src/handlers/review-idempotency.ts` — **verified against current codebase state**. `reviewOutputKey` and marker scanning already provide a cross-surface publication truth source over review comments, issue comments, and reviews.
- `src/handlers/review.test.ts` and `src/handlers/mention.test.ts` — **verified against current codebase state**. Tests pin both the clean-review Review Details behavior and the explicit approval-bridge/idempotency branches, so the milestone has existing regression seams.
- `docs/runbooks/review-requested-debug.md` and `docs/runbooks/mentions.md` — **verified against current codebase state**. Operators already have runbook guidance for correlating `deliveryId`, `reviewOutputKey`, `reviewOutputPublicationState`, `publishResolution`, and GitHub-visible outcomes.
- `docs/deployment.md` — **verified against current codebase state**. The deployment docs still describe the live ACA app/job and proof surfaces (`/healthz`, `/readiness`) needed to trust production audit evidence.
- `.gsd/milestones/M043/*` — **verified against current project state**. M043 proved one explicit-review publication repair on PR #80, but it did not add a repo-wide or recent-review audit verifier.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R045 — advances the new operator audit requirement by turning recent-review correctness into a repeatable, evidence-backed verification surface instead of a one-off manual inspection.

## Scope

### In Scope

- define the deterministic recent-review sample rule for `xbmc/xbmc` and collect the most recent ~12 Kodiai-reviewed PRs.
- classify each sampled PR using both GitHub-visible review/comment output and Kodiai’s internal publication signals.
- identify whether approval-only + Review Details outcomes are valid clean reviews or suspicious/missing-output cases.
- fix any production defects uncovered by the audit in the relevant review publication or review correctness path.
- ship a repeatable audit/verification surface and supporting operator guidance for rerunning the check later.

### Out of Scope / Non-Goals

- broad review-quality retuning across all repos or historical Kodi review behavior outside the recent `xbmc/xbmc` sample.
- redesigning Kodiai’s review style, tone, or approval policy without evidence from this audit.
- always-on monitoring/alerting infrastructure beyond the repeatable audit surface chosen for this milestone.
- automatic outward-facing GitHub actions such as reposting reviews or re-triggering PR reviews without explicit operator authorization at execution time.

## Technical Constraints

- The audit must treat `approval + Review Details only` as a **potentially valid** outcome, not a failure by default.
- Classification must be grounded in shipped signals such as `reviewOutputKey`, idempotency decisions, `reviewOutputPublicationState`, `publishResolution`, and GitHub-visible review/comment surfaces — not comment-count heuristics.
- Read-only evidence gathering is the default. Any new PR comments, re-review triggers, or other outward-facing GitHub actions still require explicit user authorization at execution time.
- The verifier must report `indeterminate` states truthfully when GitHub or internal evidence is missing, capped, or contradictory.

## Integration Points

- GitHub PR reviews / issue comments / review comments — live user-visible surfaces being audited.
- `src/handlers/review.ts` — automatic PR review publication and clean-review approval behavior.
- `src/handlers/mention.ts` — explicit `@kodiai review` publication bridge and terminal publish-resolution states.
- `src/handlers/review-idempotency.ts` — cross-surface review-output marker generation and scan logic.
- `docs/runbooks/review-requested-debug.md` and `docs/runbooks/mentions.md` — existing operator audit/debug procedures to reuse and tighten.
- Azure Container Apps / Log Analytics production evidence — delivery-correlated internal proof surfaces for publication outcomes.

## Open Questions

- What exact selection rule should define the “recent dozen” so the audit remains deterministic across reruns? — Current thinking: a documented recent-PR query keyed to Kodiai review output markers or GitHub-visible Kodiai review activity, not ad-hoc scrolling.
- Should the reusable verifier be a script, a documented command bundle, or both? — Current thinking: a script with explicit human-readable and machine-readable verdicts plus a short runbook section.
- If the audit finds suspicious approvals that need re-review, should this milestone stop at diagnosis + fix + operator guidance, or also add an optional authorized replay path? — Current thinking: diagnosis, fix, and manual guidance are in scope; automated re-triggering is not the default path.

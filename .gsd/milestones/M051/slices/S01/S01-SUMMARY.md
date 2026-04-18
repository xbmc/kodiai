---
id: S01
parent: M051
milestone: M051
provides:
  - An evidence-backed decision that `@kodiai review` is the only supported manual rereview trigger right now.
  - Hard proof that the `aireview` topology is real but still not enough to claim a supported operator workflow.
  - A concrete S02 removal plan that closes R055 without re-litigating the trigger contract.
requires:
  []
affects:
  - S02
  - S03
key_files:
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
  - .gsd/milestones/M051/slices/S02/S02-PLAN.md
  - .gsd/milestones/M051/slices/S02/tasks/T01-PLAN.md
  - .gsd/milestones/M051/slices/S02/tasks/T02-PLAN.md
  - .gsd/milestones/M051/slices/S02/tasks/T03-PLAN.md
  - .gsd/PROJECT.md
key_decisions:
  - D124 — `@kodiai review` is the only supported manual rereview trigger until fresh human-generated proof exists for the UI-team path.
  - D125 — M051/S02 should remove the unsupported `ai-review` / `aireview` contract from code/config/docs/tests instead of leaving it wired-but-unproven.
  - Issue #84 should carry the same authoritative guidance as D124/D125 so operators are not left reading an outdated or open-ended thread.
patterns_established:
  - Separate GitHub reviewer topology proof from human operator-path proof when evaluating a manual trigger contract.
  - Do not use app self-generated open-time reviewer/team requests as evidence while `src/webhook/filters.ts` drops self-events.
  - When retiring an unsupported trigger contract, sweep runtime code, config schema/defaults/examples, regression tests, and operator smoke/verifier docs — not just the main runbook and handler.
observability_surfaces:
  - Issue #84 latest closeout comment now mirrors D124/D125 and serves as the operator-facing truth surface for manual rereview guidance.
  - D124/D125 in `.gsd/DECISIONS.md` are the durable project decision record for the supported manual trigger and the S02 removal path.
  - M051/S01 entries in `.gsd/KNOWLEDGE.md` preserve the non-obvious audit rules future agents need: topology vs operator proof, self-event filtering, and four-surface R055 cleanup.
  - The rendered S02 plan artifacts provide a concrete downstream proof checklist instead of requiring future slices to reconstruct the contract from task summaries.
drill_down_paths:
  - .gsd/milestones/M051/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M051/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M051/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-18T23:45:37.677Z
blocker_discovered: false
---

# S01: Rereview trigger proof and decision

**S01 proved that the `aireview` team can currently reach `kodiai`, but no fresh human-generated UI rereview delivery exists, so `@kodiai review` is now the only supported manual rereview trigger and S02 is planned to remove the wired-but-unproven team contract.**

## What Happened

## What this slice actually delivered

S01 closed the ambiguity around manual rereview by separating two evidence classes that had been conflated in issue #84: **GitHub reviewer topology proof** versus **human operator-path proof**. Fresh GitHub API evidence showed that the original removal premise was stale: `aireview` exists on `xbmc/kodiai`, has repo access, and currently includes `kodiai` as a member. Repo-side surfaces still match that topology — `.kodiai.yml`, `docs/configuration.md`, `docs/runbooks/review-requested-debug.md`, `src/handlers/review.ts`, `src/handlers/rereview-team.ts`, and their tests still encode the `ai-review` / `aireview` path.

The slice also proved why that is **not enough** to keep claiming the UI trigger is supported. `src/webhook/filters.ts` intentionally drops app self-events, so the open-time auto-requested rereview-team event cannot count as manual-operator proof either for or against the UI path. Without a fresh human remove/re-request delivery carrying `requested_team`, the UI-team lane remains **wired but unproven** rather than operator-supported.

On top of that audit, S01 recorded the authoritative contract decision in D124: treat `@kodiai review` as the only supported manual rereview trigger until fresh human-generated proof exists for the UI-team path. It then converted that into an executable follow-on decision in D125: S02 should remove the unsupported `ai-review` / `aireview` contract from code/config/docs/tests instead of leaving stale claims in place. The slice rendered the full S02 plan and task plans so the next slice can execute the removal without re-litigating the contract.

During closeout, issue #84 was updated again so its latest authoritative guidance matches the final slice outcome: `@kodiai review` is the supported manual trigger, operators should not rely on removing/re-requesting `ai-review` / `aireview`, and S02 should remove the wired-but-unproven UI-team path.

## Patterns and downstream guidance

- Separate **topology proof** from **operator-path proof** whenever a manual trigger depends on GitHub reviewer state; a reachable team is not the same thing as a proven operator workflow.
- Never use self-generated open-time reviewer/team requests as proof for manual rereview behavior while `src/webhook/filters.ts` drops app-originated events.
- R055 cleanup is broader than the main runbook and handler: downstream slices must sweep runtime code, config schema/defaults/examples, regression tests, and operator smoke/verifier docs.
- S02 can now proceed directly on the removal branch. It does not need more contract research unless a human-driven slice chooses to gather fresh UI-team proof later.

## Slice limits

S01 did **not** produce a fresh human-generated `pull_request.review_requested` delivery, so R055 is not validated yet. The wired-but-unproven UI-team contract still exists in the runtime/docs/config today and remains active work for S02.

## Verification

Fresh closeout verification passed against the assembled slice outputs:

- `gh api repos/xbmc/kodiai/teams`, `gh api orgs/xbmc/teams/aireview/members`, and `gh api users/kodiai` confirmed the live topology still shows `aireview` on `xbmc/kodiai` with push access and `kodiai` as a member.
- `gh issue view 84 -R xbmc/kodiai --comments --json title,state,url,comments --jq '{title,state,url,latestComment: (.comments[-1] | {author: .author.login, url: .url, hasSupportedTrigger: (.body | contains("@kodiai review")), hasUiUnsupported: (.body | contains("Do not rely on")), hasDecisionD125: (.body | contains("Decision D125"))})}'` passed after the closeout comment update, proving the latest issue guidance now matches D124/D125.
- `rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview|Accepted review_requested event for rereview team|Filtered: event from app itself|@kodiai review|remove the unsupported|sole supported manual rereview trigger" ...` across the audited docs/code/tests, `.gsd/DECISIONS.md`, `.gsd/KNOWLEDGE.md`, and the generated S02 plan confirmed all three facts simultaneously: the UI-team path is still encoded today, the self-event filter explains why open-time auto-requests are not operator proof, and D124/D125 plus the S02 plans define the supported contract and removal scope.
- `bun test ./src/handlers/rereview-team.test.ts ./src/handlers/review.test.ts --test-name-pattern 'rereview|ui rereview team request'` passed 7/7 tests, proving the current repo still accepts the team-based rereview path and auto-request-on-open behavior.
- `bun test ./src/handlers/mention.test.ts --test-name-pattern 'uses review task type and review output key|triggers executor instead of delegating to aireview team'` passed 3/3 tests, proving `@kodiai review` remains the surviving explicit manual trigger lane and already routes to review execution rather than team delegation.
- `find .gsd/milestones/M051/slices/S02 -maxdepth 2 -type f | sort` confirmed the handoff artifacts exist: `S02-PLAN.md` plus task plans `T01-PLAN.md`, `T02-PLAN.md`, and `T03-PLAN.md`.

No slice-level verification check failed after closeout.

## Requirements Advanced

- R055 — S01 established the truthful supported-trigger contract (`@kodiai review` only), recorded D124/D125, updated issue #84, and rendered the exact S02 removal scope needed to validate R055 in the next slice.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

During slice closeout, issue #84 needed one more comment so the latest visible issue guidance matched D125 instead of ending on an open 'prove or remove?' question. No code-path decision changed; the closeout comment only aligned the issue thread with the final recorded decision.

## Known Limitations

No fresh human-generated `pull_request.review_requested` delivery was produced in S01, so the UI-team path remains wired-but-unproven and R055 stays active until S02 removes the stale contract surface. The runtime/docs/config still contain the old team-trigger path today by design of this slice boundary.

## Follow-ups

Execute M051/S02 on the removal branch from D125: remove `ai-review` / `aireview` from runtime code, config schema/defaults/examples, docs/smoke artifacts, and tests; then use S03 only for any remaining operator/verifier truthfulness debt after the manual trigger contract is settled.

## Files Created/Modified

- `.gsd/DECISIONS.md` — Recorded D124 and D125, establishing the supported manual rereview contract and the S02 removal path.
- `.gsd/KNOWLEDGE.md` — Captured the non-obvious audit rules future slices need: topology vs operator-path proof, GitHub bot fallback, and full-surface R055 cleanup.
- `.gsd/milestones/M051/slices/S02/S02-PLAN.md` — Rendered the downstream slice plan that removes the unsupported UI-team rereview contract and preserves `@kodiai review` as the surviving manual trigger.
- `.gsd/milestones/M051/slices/S02/tasks/T01-PLAN.md` — Defined the runtime/code/config removal work for the stale UI-team path.
- `.gsd/milestones/M051/slices/S02/tasks/T02-PLAN.md` — Defined the operator docs, smoke docs, and example-config cleanup work for the stale UI-team path.
- `.gsd/milestones/M051/slices/S02/tasks/T03-PLAN.md` — Defined the regression-proof work that keeps `@kodiai review` as the only supported manual rereview lane.
- `.gsd/PROJECT.md` — Refreshed project current-state documentation to reflect M051 activation, S01 completion, and the D124/D125 contract.

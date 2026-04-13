---
id: M049
title: "Evidence-Backed Clean PR Approvals"
status: complete
completed_at: 2026-04-13T15:59:37.814Z
key_decisions:
  - D098 — Use one shared short evidence-backed GitHub review body for clean approvals instead of marker-only approval text.
  - D116 — Define that shared clean-approval body as visible plain markdown with `Decision: APPROVE`, `Issues: none`, a bounded `Evidence:` block, and the existing marker.
  - D117 — Require approve-via-comment to promote only the shared visible APPROVE grammar while keeping marker stamping server-side.
  - D118 — Add a dedicated explicit-lane verifier that combines exact `reviewOutputKey` artifact proof with Azure publish-resolution correlation instead of widening publisher handlers.
  - D119 — Map low-level artifact/body mismatches into stable operator-facing statuses while preserving raw artifact and body-contract details for debugging.
key_files:
  - src/handlers/review-idempotency.ts
  - src/handlers/mention.ts
  - src/handlers/review.ts
  - src/execution/mcp/comment-server.ts
  - src/execution/mention-prompt.ts
  - src/review-audit/review-output-artifacts.ts
  - scripts/verify-m049-s02.ts
  - package.json
lessons_learned:
  - Exact `reviewOutputKey` proof needs a dedicated per-surface collector; latest-only audit samplers will hide duplicates and wrong-surface outcomes.
  - Shared visible clean-approval bodies should stay machine-checkable and server-stamped so approval publication, idempotency, and verification remain aligned across lanes.
  - A milestone can be code-complete and operator-surface-complete without fabricating new production validation evidence; live-access proof should remain an explicit follow-up instead of being flattened into a false green.
---

# M049: Evidence-Backed Clean PR Approvals

**Unified clean PR approvals onto one shared evidence-backed APPROVE review body and added an exact explicit-lane verifier that proves one visible GitHub approval outcome with audit correlation.**

## What Happened

M049 delivered the clean-approval contract in two connected slices. S01 replaced marker-only clean approvals with one shared visible GitHub review body emitted by `buildApprovedReviewBody(...)` and reused by the explicit `@kodiai review`, automatic review, and approve-via-comment approval lanes. That body now carries `Decision: APPROVE`, `Issues: none`, a bounded `Evidence:` block with 1–3 factual bullets, optional approval-confidence evidence when available, and the existing `review-output-key` marker, while the comment server remains the narrow validation boundary that server-stamps the marker and rejects malformed APPROVE bodies.

S02 then added the exact proof surface required to verify the explicit mention-review lane truthfully. `src/review-audit/review-output-artifacts.ts` preserves every matching review, issue comment, and review comment for one requested `reviewOutputKey` and validates counts, surface, review state, and shared-body contract without collapsing results into latest-only sampling. `scripts/verify-m049-s02.ts` exposes that proof as a read-only operator command, rejects malformed/non-explicit keys before live lookup, and joins exact GitHub artifact proof to Azure explicit-lane publish-resolution evidence with stable named failure states.

Fresh milestone-close verification passed in this session: `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'` returned non-`.gsd/` code changes; `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts ./src/review-audit/review-output-artifacts.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m049-s02.test.ts` passed with 352 pass / 0 fail; and `bun run tsc --noEmit` passed.

## Decision Re-evaluation

| Decision | Re-evaluation | Status |
| --- | --- | --- |
| D098 — use one shared short evidence-backed GitHub review body for clean approvals | Still correct. The shared builder eliminated marker-only divergence across explicit mention, automatic review, and approve-via-comment approval lanes while keeping publication/idempotency behavior intact. | Keep |
| D116 — define the shared clean-approval body as visible plain markdown with `Decision: APPROVE`, `Issues: none`, `Evidence:`, and the marker | Still correct. Fresh helper, handler, prompt, and comment-server tests prove the grammar is compact, review-surface-visible, and machine-checkable. | Keep |
| D117 — approve-via-comment should promote only the visible APPROVE grammar while server-stamping the marker | Still correct. The narrow validation boundary prevented wrapped/prose-heavy near-misses from becoming GitHub approvals and preserved server-side marker ownership. | Keep |
| D118 — add a dedicated explicit-lane live verifier instead of widening publisher handlers | Still correct. The exact-proof seam kept operator/audit logic separate from publish-time handlers and enabled stable named failure surfaces without perturbing runtime publication paths. | Keep |
| D119 — map low-level artifact/body mismatches into stable operator-facing status codes while preserving raw details | Still correct. The verifier now fails closed with named statuses but still surfaces `artifactCounts`, `artifact`, `bodyContract`, and Azure audit details for debugging. | Keep |

Milestone closeout intentionally did not claim new production validation evidence for R043. The shipped verifier success path still needs one fresh accessible explicit clean-approval key plus working GitHub/Azure access to capture a live `m049_s02_ok` report; in this environment the code and operator-surface contract are complete, but fresh live proof remains a follow-up validation activity rather than a blocker to milestone completion.

## Success Criteria Results

- [x] **Shared evidence-backed clean approval body across approval lanes.** S01 made `src/handlers/review-idempotency.ts` the canonical clean-approval formatter and routed both `src/handlers/mention.ts` and `src/handlers/review.ts` through it, while `src/execution/mcp/comment-server.ts` and `src/execution/mention-prompt.ts` enforce the same visible APPROVE grammar. Fresh milestone-close tests covering those seams passed: `review-idempotency.test.ts`, `mention.test.ts`, `review.test.ts`, `comment-server.test.ts`, and `mention-prompt.test.ts` all passed inside the 352-pass verification run.
- [x] **Exactly one visible explicit-lane GitHub outcome is provable and audit-correlatable.** S02 added `src/review-audit/review-output-artifacts.ts` plus `scripts/verify-m049-s02.ts`, giving operators one exact per-`reviewOutputKey` proof path with per-surface counts, visible-body validation, and Azure publish-resolution correlation. Fresh milestone-close tests (`review-output-artifacts.test.ts`, `evidence-correlation.test.ts`, `verify-m049-s02.test.ts`) passed and prove duplicate, wrong-surface, wrong-state, body-drift, and audit-mismatch branches. Fresh accessible live success evidence remains pending, so this closeout advances the code/operator contract without claiming a new production validation run.

## Definition of Done Results

- [x] **All slices complete.** `gsd_milestone_status("M049")` reports S01 complete (3/3 tasks done) and S02 complete (2/2 tasks done).
- [x] **Slice summaries exist.** `find .gsd/milestones/M049 -maxdepth 3 -type f | sort` showed both `.gsd/milestones/M049/slices/S01/S01-SUMMARY.md` and `.gsd/milestones/M049/slices/S02/S02-SUMMARY.md`.
- [x] **The milestone contains real non-planning code changes.** `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'` returned non-`.gsd/` files including handler, MCP, review-audit, script, config, and test changes.
- [x] **Cross-slice integration works.** Fresh combined milestone-close verification passed: the eight-file targeted Bun run reported `352 pass, 0 fail`, and `bun run tsc --noEmit` passed. Those checks cover the S01 shared approval body contract plus the S02 exact-proof/verifier seams together.
- [x] **Horizontal checklist.** No separate Horizontal Checklist was surfaced in the provided M049 roadmap context, so there were no additional unchecked checklist items to carry forward.

## Requirement Outcomes

- **R043** remained **Active** in this closeout; there was **no status transition** to persist. M049 advanced the requirement by reusing one shared visible evidence-backed APPROVE body on the explicit `@kodiai review` clean-approval lane and by adding the exact `verify:m049:s02` operator proof surface. Evidence: fresh milestone-close verification passed (`352 pass, 0 fail`; `bun run tsc --noEmit` passed), and the shipped verifier now enforces exact per-surface counts, visible-body validation, and Azure publish-resolution correlation. A fresh accessible live `m049_s02_ok` run is still required before claiming new production validation evidence for this requirement.

## Deviations

Fresh milestone-close verification did not include a new successful live `m049_s02_ok` production-style run from this environment. The shipped verifier and code/test contract were reverified locally, but GitHub/Azure-access-gated runtime proof remains a follow-up validation activity.

## Follow-ups

When GitHub review-artifact access and Azure workspace access are available, capture a fresh explicit clean-approval `reviewOutputKey` and rerun `bun run verify:m049:s02 -- --repo <owner/repo> --review-output-key <fresh-key> --json` to record a live `m049_s02_ok` report for future requirement validation evidence.

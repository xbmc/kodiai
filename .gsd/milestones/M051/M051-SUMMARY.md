---
id: M051
title: "Manual rereview trigger truthfulness"
status: complete
completed_at: 2026-04-19T01:03:27.666Z
key_decisions:
  - D124 — `@kodiai review` is the only supported manual rereview trigger until fresh human-generated proof exists for the UI-team path.
  - D125 — remove the unsupported `ai-review` / `aireview` contract from runtime/config/docs/tests instead of leaving it wired-but-unproven.
  - D126 — prove the surviving manual rereview contract through explicit mention completion and team-only skip observability surfaces.
  - D127 — use the shared `TimeoutReviewDetailsProgress` type instead of a duplicated local literal in `src/handlers/review.ts`.
  - D128 — correlated phase rows missing `conclusion` and/or `published` are `invalid-phase-payload` evidence, not `ok`.
  - D129 — operator-facing M048 summaries must distinguish true no-evidence from incomplete evidence and render `publication unknown` when publication state is null.
key_files:
  - src/handlers/review.ts
  - src/handlers/mention.ts
  - src/execution/config.ts
  - docs/runbooks/review-requested-debug.md
  - docs/configuration.md
  - docs/smoke/phase75-live-ops-verification-closure.md
  - .kodiai.yml
  - src/review-audit/phase-timing-evidence.ts
  - scripts/verify-m048-s01.ts
  - scripts/verify-m048-s03.test.ts
  - src/lib/review-utils.ts
lessons_learned:
  - Reviewer-team topology is not operator-path proof; a reachable GitHub team must not be documented as a supported manual trigger without fresh human-generated evidence.
  - Retiring a stale trigger contract requires a full sweep across runtime behavior, config schema/examples, docs, smoke artifacts, and regression tests; fixing only one surface leaves false truth behind.
  - Truthful verification surfaces need explicit tri-state wording for partial evidence; matched-but-incomplete payloads should stay diagnosable instead of being collapsed into either success or no-evidence.
---

# M051: Manual rereview trigger truthfulness

**M051 made `@kodiai review` the only truthful supported manual rereview trigger, removed the stale `ai-review` / `aireview` contract from shipped surfaces, and closed the remaining M048 operator/verifier truthfulness debt.**

## What Happened

M051 started by separating GitHub reviewer-team topology proof from real operator-path proof. S01 showed that `aireview` topology could still exist while failing to prove a supported human rereview workflow, so D124 locked the truthful contract to explicit `@kodiai review` mentions and D125 chose removal over continued documentation of a wired-but-unproven UI-team path. S02 then executed that contract change across runtime code, checked-in config, docs, smoke artifacts, and regression tests: direct Kodiai reviewer requests still work, but team-only `pull_request.review_requested` deliveries now skip cleanly, and explicit `@kodiai review` runs stay on the supported `interactive-review` / `review.full` path. S03 closed the remaining PR #87 truthfulness debt by hardening phase-timing evidence handling, restoring tri-state M048 verifier wording for incomplete payloads, reusing the same outcome summary across S01/S03 proof surfaces, and removing the last stale doc/type drift. Fresh milestone-close verification confirmed both halves of the milestone together: the manual rereview contract is now truthful and single-sourced, and the correlated M048 proof/report surfaces no longer overclaim when evidence is partial.

## Success Criteria Results

- [x] **Manual rereview contract is truthful and operator-safe.** Fresh verification showed the supported manual trigger is the explicit PR-scoped `@kodiai review` path: `bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts ./src/handlers/mention.test.ts` passed **327/327**, including direct Kodiai `review_requested` handling, team-only request skips, and explicit mention-review routing on `interactive-review` / `review.full`.
- [x] **Unsupported `ai-review` / `aireview` rereview claims are removed from shipped surfaces.** `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'` showed non-`.gsd/` code/documentation changes across **32 files**. Fresh closeout sweep `! rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview" docs/runbooks/review-requested-debug.md docs/configuration.md docs/smoke/phase75-live-ops-verification-closure.md .kodiai.yml` returned success with no stale matches, while the paired positive grep confirmed `@kodiai review`, `interactive-review`, `review.full`, and `team-only-request` observability surfaces remain documented/implemented.
- [x] **Residual PR #87 operator/verifier truthfulness debt is retired instead of stranded.** `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts ./scripts/verify-m048-s03.test.ts ./src/lib/review-utils.test.ts` passed **45/45**, proving incomplete correlated phase rows surface as `invalid-phase-payload`, `publication unknown` wording is preserved where required, and the downstream S03 verifier reuses the S01 summary contract verbatim. `bun run tsc --noEmit` completed successfully, confirming the shared timeout Review Details typing and surrounding truthfulness cleanup remain type-safe.

## Definition of Done Results

- [x] **All slices complete.** `gsd_milestone_status("M051")` reports S01, S02, and S03 all `complete`, with task counts 3/3 done in each slice.
- [x] **All slice summaries exist.** `find .gsd/milestones/M051 -maxdepth 3 \( -name '*-SUMMARY.md' -o -name '*-ROADMAP.md' \) | sort` returned the roadmap plus `S01-SUMMARY.md`, `S02-SUMMARY.md`, and `S03-SUMMARY.md`.
- [x] **Cross-slice integration points work together.** The fresh review/config/mention test batch (327/327), the fresh M048 parser/verifier/utilities test batch (45/45), the stale-trigger grep sweep, and `bun run tsc --noEmit` together verify that S01’s contract decision, S02’s runtime/config/docs removal, and S03’s proof-surface truthfulness changes coexist without regression.
- [x] **Horizontal checklist.** No separate Horizontal Checklist was present in the preloaded M051 roadmap context, so there were no additional checklist items to audit at closeout.

## Requirement Outcomes

- **R055 — Active → Validated.** Supported by fresh milestone-close evidence: the review/config/mention tests passed with team-only `ai-review` / `aireview` requests skipped and explicit `@kodiai review` runs staying on `interactive-review` / `review.full`; the docs/config/.kodiai.yml grep sweep confirmed the stale UI-team contract was removed while the surviving explicit trigger remained documented; `bun run tsc --noEmit` passed.
- **R049 — unchanged status (Active).** M051/S03 advanced the requirement by making incomplete correlated phase payloads explicit instead of silently optimistic, but no milestone-level status transition was claimed beyond that evidence-backed hardening.
- **R050 — unchanged status (Active).** M051/S03 advanced the requirement by preserving truthful tri-state publication wording and shared downstream summaries, but no separate status transition was claimed during this milestone.

## Decision Re-evaluation

| Decision | Still valid? | Evidence | Revisit next milestone? |
| --- | --- | --- | --- |
| D124 — `@kodiai review` is the only supported manual rereview trigger until fresh human-generated proof exists for the UI-team path. | Yes | Fresh closeout tests and grep proof show the supported path is the explicit mention flow, while team-only requests stay unsupported negatives. | Only if a future milestone gathers fresh human-generated UI-team proof. |
| D125 — remove the unsupported `ai-review` / `aireview` contract from runtime/config/docs/tests. | Yes | S02 removal landed across runtime, config, docs, smoke artifacts, and tests; the stale-string grep sweep stayed clean at milestone close. | No. |
| D126 — prove the surviving manual rereview contract through explicit mention completion and team-only skip observability surfaces. | Yes | `mention.ts` / `review.ts` now expose `lane=interactive-review`, `taskType=review.full`, and `skipReason=team-only-request`; fresh tests and grep proof exercised those surfaces. | No. |
| D127 — use the shared `TimeoutReviewDetailsProgress` type instead of a duplicated local literal in `src/handlers/review.ts`. | Yes | `bun run tsc --noEmit` passed after the type dedup, proving the single-sourced timeout progress surface still compiles. | No. |
| D128 — correlated phase rows missing `conclusion` and/or `published` are `invalid-phase-payload` evidence, not `ok`. | Yes | The fresh M048 parser/verifier test batch passed with explicit incomplete-payload regressions covering the `invalid-phase-payload` contract. | No. |
| D129 — operator-facing M048 summaries must distinguish true no-evidence from incomplete evidence and render `publication unknown` when publication state is null. | Yes | Fresh `verify-m048-s01` / `verify-m048-s03` tests passed and kept the repaired tri-state wording plus shared summary reuse green. | No. |

## Deviations

None.

## Follow-ups

If a future milestone wants to reintroduce a team-based manual rereview path, it must first gather fresh human-generated proof and only then re-add runtime/config/docs/tests. Otherwise, keep auditing the surviving `@kodiai review` proof surfaces for drift.

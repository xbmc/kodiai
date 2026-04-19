---
id: T03
parent: S01
milestone: M051
key_files:
  - .gsd/milestones/M051/slices/S02/S02-PLAN.md
  - .gsd/milestones/M051/slices/S02/tasks/T01-PLAN.md
  - .gsd/milestones/M051/slices/S02/tasks/T02-PLAN.md
  - .gsd/milestones/M051/slices/S02/tasks/T03-PLAN.md
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D125 — Close R055 in S02 by removing the unsupported `ai-review` / `aireview` UI-team contract and keeping `@kodiai review` as the sole supported manual rereview trigger.
duration: 
verification_result: passed
completed_at: 2026-04-18T23:38:41.599Z
blocker_discovered: false
---

# T03: Planned M051/S02 to remove the unsupported UI-team rereview contract and keep `@kodiai review` as the only supported manual trigger.

**Planned M051/S02 to remove the unsupported UI-team rereview contract and keep `@kodiai review` as the only supported manual trigger.**

## What Happened

I executed T03 as a real downstream-planning handoff rather than a prose-only note. First I re-read the T03 contract, the S01 slice plan, the T01/T02 summaries, R055, D124, and the current roadmap state to confirm what was already decided versus what still needed to be made executable. That local verification showed S02 had no plan yet, so the durable output for this task needed to be the actual S02 slice plan.

I then inspected the live code/doc/config surfaces that still encode the old rereview-team contract. The key finding was that the cleanup surface is broader than the original five-file hint: besides `src/handlers/review.ts`, `.kodiai.yml`, and the main runbook, the stale contract also lives in the config schema/defaults (`src/execution/config.ts` and `src/execution/config.test.ts`), the optional rereview helper and its tests (`src/handlers/rereview-team.ts` / `.test.ts`), and the older smoke doc `docs/smoke/phase75-live-ops-verification-closure.md`. That matters because leaving any of those behind would let S02 fix the obvious docs while still teaching operators and future agents the wrong trigger contract.

Using that evidence plus D124, I chose the executable closure branch for S02: remove the unsupported `ai-review` / `aireview` UI-team contract instead of waiting for fresh human-generated proof that auto-mode cannot produce. I rendered that as the canonical `M051/S02` slice plan with three concrete tasks: T01 removes the UI-team code/config surface, T02 retires the stale operator docs/config/smoke claims, and T03 locks the surviving `@kodiai review` proof surface through mention/review regression coverage. After rendering the plan I caught and fixed one real plan defect — the docs-cleanup verification command originally used plain `rg` where zero matches were expected, so I regenerated the slice plan with `! rg ... && rg ...` to make the task literally executable.

Finally, I recorded the downstream planning choice as decision D125 and added a knowledge entry documenting that R055 cleanup must sweep runtime code paths, config schema/defaults/examples, regression tests, and operator smoke/verifier docs — not just the main runbook and review handler. No production code changed in T03 itself; the shipped output is the executable S02 plan, plus the decision/knowledge trail that keeps the next slice from re-litigating the contract.

## Verification

I verified the planning output directly from disk. A filesystem check confirmed the rendered S02 artifacts exist (`S02-PLAN.md` plus task plans T01–T03). A targeted `rg` pass over the generated slice/task plans confirmed the implementation brief names the actual downstream surfaces that local inspection proved matter: `src/handlers/review.ts`, `src/execution/config.ts`, `docs/smoke/phase75-live-ops-verification-closure.md`, `src/handlers/mention.test.ts`, the `@kodiai review` contract, and the corrected negative/positive docs verification command. A second `rg` pass confirmed decision D125 and the new R055 knowledge note were both persisted. Because T03 is a planning/proof task, verification was artifact/state-based rather than runtime-code-based.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `find .gsd/milestones/M051/slices/S02 -maxdepth 2 -type f | sort` | 0 | ✅ pass | 3ms |
| 2 | `rg -n "Remove the unsupported UI-team rereview contract|src/handlers/review.ts|src/execution/config.ts|docs/smoke/phase75-live-ops-verification-closure.md|src/handlers/mention.test.ts|@kodiai review|! rg -n \"uiRereviewTeam\|requestUiRereviewTeamOnOpen\|ai-review\|aireview\"" .gsd/milestones/M051/slices/S02/S02-PLAN.md .gsd/milestones/M051/slices/S02/tasks/T01-PLAN.md .gsd/milestones/M051/slices/S02/tasks/T02-PLAN.md .gsd/milestones/M051/slices/S02/tasks/T03-PLAN.md` | 0 | ✅ pass | 13ms |
| 3 | `rg -n "D125|How M051/S02 should close R055 after D124|R055 cleanup reaches beyond the runbook and handler" .gsd/DECISIONS.md .gsd/KNOWLEDGE.md` | 0 | ✅ pass | 5ms |

## Deviations

Expanded the S02 implementation brief beyond the original task-file hint to include `src/execution/config.ts`, `src/execution/config.test.ts`, `src/handlers/rereview-team.ts`, `src/handlers/rereview-team.test.ts`, and `docs/smoke/phase75-live-ops-verification-closure.md` after local repo inspection showed they still encode the stale UI-team contract. Also regenerated the slice plan once to correct the T02 verification command so zero-match assertions use `! rg` instead of failing for the wrong reason.

## Known Issues

The unsupported UI-team rereview contract is still present in the runtime/docs today; T03 only planned its removal. R055 will remain open until S02 executes the rendered tasks and reruns their proof commands.

## Files Created/Modified

- `.gsd/milestones/M051/slices/S02/S02-PLAN.md`
- `.gsd/milestones/M051/slices/S02/tasks/T01-PLAN.md`
- `.gsd/milestones/M051/slices/S02/tasks/T02-PLAN.md`
- `.gsd/milestones/M051/slices/S02/tasks/T03-PLAN.md`
- `.gsd/DECISIONS.md`
- `.gsd/KNOWLEDGE.md`

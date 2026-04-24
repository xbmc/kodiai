---
id: M062
title: "Large-PR truth baseline"
status: complete
completed_at: 2026-04-24T05:10:52.227Z
key_decisions:
  - Treat large-PR review as a hybrid contract: useful bounded first-pass output now, deeper review later.
  - Use one normalized bounded first-pass state as the single contract for constrained review publication, reserving hard failure for zero-evidence runs.
  - Derive both public bounded comments and Review Details from the same visible-state formatter contract to prevent wording drift.
  - Prove milestone behavior through deterministic verifier scripts that exercise production formatter seams instead of proof-only prose builders.
key_files:
  - src/lib/review-first-pass.ts
  - src/lib/review-utils.ts
  - src/lib/partial-review-formatter.ts
  - src/handlers/review.ts
  - scripts/verify-m062-s01.ts
  - scripts/verify-m062-s03.ts
  - package.json
lessons_learned:
  - Normalizing constrained outcomes before formatting is the cleanest way to keep timeout, large-PR boundedness, and max-turns fallback truthful on the same surface.
  - Visible bounded-review regressions are easiest to catch by checking semantic parity keys across production renderers instead of snapshotting full comment bodies.
  - Retry metadata must stay additive to first-pass coverage state; otherwise merged checkpoint totals drift into double-counted reviewed scope.
---

# M062: Large-PR truth baseline

**M062 established and proved a truthful bounded large-PR first-pass contract, unified the visible bounded-review surfaces around it, and added deterministic verifier gates that block regressions.**

## What Happened

M062 replaced the old large-PR dead-end `max_turns` behavior with one normalized bounded first-pass contract that all constrained review outcomes project through before publication. S01 introduced the shared `normalizeReviewFirstPass` seam plus the deterministic `verify:m062:s01` harness so timeout, bounded large-PR, checkpoint-backed `max_turns`, and zero-evidence failure all classify truthfully from the same payload. S02 then removed wording drift by routing the public bounded comment and Review Details through the same visible-state contract in the formatter and review handler, including truthful degradation when scope fields are missing and correct retry-merge coverage handling. S03 closed the milestone by adding `verify:m062:s03`, which reuses the S01 scenario matrix and production renderers to prove semantic parity across bounded reason, covered scope, remaining scope, continuation state, and explicit zero-evidence rejection. Fresh milestone-close verification also reconfirmed the relevant formatter, handler, verifier, and TypeScript gates, so the assembled milestone now delivers a bounded-first-pass review experience that is useful, honest, and machine-checkable instead of a misleading dead-end.

## Success Criteria Results

- ✅ **Large PRs produce a truthful bounded first-pass review contract instead of a dead-end `max_turns` user experience.** Evidence: S01 established `normalizeReviewFirstPass` as the shared constrained-review contract and S03 revalidated it end-to-end. Fresh verification passed: `bun run verify:m062:s01 -- --json` returned `status_code: "m062_s01_ok"` across 4 scenarios, with `timeout-checkpoint`, `max-turns-checkpoint`, and `large-pr-bounded` classified as `bounded-first-pass`, while `zero-evidence-failure` remained a truthful `dead-end-failure`. `bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts` also passed 20/20.
- ✅ **The visible review surface reports coverage and in-progress state coherently without implying exhaustiveness.** Evidence: S02 unified Review Details and bounded public comments on one shared formatter contract, and S03 proved both surfaces stay aligned. Fresh verification passed: `bun run verify:m062:s03 -- --json` returned `status_code: "m062_s03_ok"`; the timeout, max-turns, and large-PR scenarios all reported `bounded-parity-ok` with passing parity checks for bounded reason, covered scope, remaining scope, and continuation state. Supporting tests also passed: `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts` (159/159).
- ✅ **A deterministic proof surface catches regressions in large-PR first-pass truthfulness.** Evidence: the milestone now ships two deterministic verifier surfaces wired in `package.json`: `verify:m062:s01` proves bounded-vs-dead-end first-pass classification, and `verify:m062:s03` proves visible-surface parity plus zero-evidence rejection. Fresh milestone-close verification reran both verifiers successfully, and `bun run tsc --noEmit` exited 0.

## Definition of Done Results

- ✅ **All slices complete.** `gsd_milestone_status` reports S01, S02, and S03 with status `complete`; each slice shows 3/3 tasks done.
- ✅ **All slice summaries exist.** Present on disk: `.gsd/milestones/M062/slices/S01/S01-SUMMARY.md`, `.gsd/milestones/M062/slices/S02/S02-SUMMARY.md`, and `.gsd/milestones/M062/slices/S03/S03-SUMMARY.md`.
- ✅ **Cross-slice integration works.** S01's normalized first-pass payload is consumed by S02's shared visible-state formatter contract and by S03's deterministic verifier. Fresh proof: `bun run verify:m062:s01 -- --json` succeeded for the classification matrix; `bun run verify:m062:s03 -- --json` succeeded for visible-surface parity and explicit zero-evidence rejection.
- ✅ **Code changes exist beyond planning artifacts.** Using the integration-branch equivalent diff (`git diff --stat $(git merge-base HEAD origin/main)..HEAD -- ':!.gsd/'`) showed 69 non-`.gsd/` files changed, including `src/lib/review-first-pass.ts`, `src/lib/review-utils.ts`, `src/lib/partial-review-formatter.ts`, `src/handlers/review.ts`, `scripts/verify-m062-s01.ts`, `scripts/verify-m062-s03.ts`, and `package.json`.
- ℹ️ **Horizontal checklist.** None was defined in the roadmap.

## Requirement Outcomes

- **R061** moved to **validated** with milestone-level proof. Evidence: `bun run verify:m062:s01 -- --json` returned `m062_s01_ok` with checkpoint-backed timeout and `max_turns` scenarios classified as `bounded-first-pass`, and `bun run verify:m062:s03 -- --json` confirmed the visible bounded surfaces preserve that truthful contract while keeping the zero-evidence path as a rejected dead-end.
- **R064** moved to **validated** with milestone-level proof. Evidence: `bun run verify:m062:s03 -- --json` returned `m062_s03_ok`; the timeout, max-turns, and large-PR bounded scenarios each produced `bounded-parity-ok` with passing checks for covered scope, remaining scope, and continuation state across both visible surfaces. Supporting formatter/handler tests passed 159/159.

## Deviations

None at milestone level; the delivered work matches the roadmap’s three-slice plan and success criteria.

## Follow-ups

Build M063 on top of the now-proven contract: automatic continuation, same-comment updates, and explicit revision semantics for later passes. If `capture_thought` failures recur in future milestones, fix that platform issue before depending on memory extraction automation.

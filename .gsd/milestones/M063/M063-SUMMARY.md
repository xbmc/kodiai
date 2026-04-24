---
id: M063
title: "Continuation-driven review execution"
status: complete
completed_at: 2026-04-24T06:48:29.261Z
key_decisions:
  - Keep the base `reviewOutputKey` as the stable public lifecycle identity while deriving retry-suffixed continuation pass keys internally.
  - Extract continuation planning and settlement into `src/lib/review-continuation-lifecycle.ts` so handler code orchestrates side effects instead of owning lifecycle state rules.
  - Use the bounded first-pass comment as the canonical public continuation surface and refresh nested Review Details plus explicit revision summaries in place.
  - Prove boundedness and stale-authority safety with deterministic verifier scripts built on production seams rather than ad hoc snapshots or mock-only evidence.
key_files:
  - src/lib/review-continuation-lifecycle.ts
  - src/handlers/review.ts
  - src/lib/partial-review-formatter.ts
  - src/execution/review-prompt.test.ts
  - src/handlers/review.test.ts
  - scripts/verify-m063-s01.ts
  - scripts/verify-m063-s02.ts
  - scripts/verify-m063-s03.ts
  - package.json
lessons_learned:
  - Separating continuation lifecycle decisions from handler orchestration made later same-surface and proof work cheaper and safer to verify.
  - Canonical-comment ownership plus explicit revision/no-delta classification is the right public contract for continuation; second lifecycle comments would have created churn and ambiguity.
  - Deterministic milestone verifiers built on production seams are strong enough to close architectural proof obligations without adding new runtime complexity.
---

# M063: Continuation-driven review execution

**M063 turned large-PR continuation into the default bounded-review lifecycle: first-pass bounded reviews now continue automatically, deepen one canonical public surface with explicit revisions, stay materially narrower than the first pass, and remain authority-safe against stale overwrite attempts.**

## What Happened

M063 completed the continuation redesign in three integrated slices. S01 extracted continuation planning and settlement out of timeout-specialized handler branches into `src/lib/review-continuation-lifecycle.ts`, keeping the base `reviewOutputKey` as the public lifecycle identity while deriving retry pass keys for internal continuation work. Fresh milestone-close verification re-ran `scripts/verify-m063-s01.ts --json` and returned `status_code: "m063_s01_ok"` for scheduling, merge-ready settlement, quiet no-delta settlement, no-follow-up, and stale-authority suppression scenarios, confirming the automatic queued continuation lifecycle still works on the shipped seam.

S02 anchored continuation-visible work to one canonical public surface instead of emitting additional lifecycle comments. Fresh milestone-close verification re-ran `bun run verify:m063:s02 -- --json` and returned `status_code: "m063_s02_ok"`; all three scenarios reported `visibleSurfaceCount: 1`, `continuationSurfaceCount: 0`, and passed marker continuity, Review Details attachment, same-surface ownership, and quiet-settlement/revision-visibility checks. That confirms continuation now revises the existing bounded comment in place and only renders explicit revision wording when there is a meaningful delta.

S03 closed the proof gap without broadening runtime scope. Fresh milestone-close verification re-ran `bun run verify:m063:s03 -- --json` and returned `status_code: "m063_s03_ok"`; both scenarios proved continuation narrows `review-change-context`, omits first-pass-only `review-size-context`, preserves required sections, and avoids exhaustive-coverage claims. `bun run tsc --noEmit` also exited 0, preserving clean integration state. Together with S02’s same-surface verifier and the strengthened retry handler coverage documented in the slice summaries, the milestone now has deterministic evidence that stale or superseded continuation cannot overwrite the canonical summary or nested Review Details on the shipped paths.

## Decision Re-evaluation

| Decision | Re-evaluation | Outcome |
| --- | --- | --- |
| D181 — stable public review identity on base `reviewOutputKey` | Fresh S02 verification still showed one visible surface and zero continuation-only surfaces, so the public identity split from retry pass identity remains correct. | Still valid |
| D182 — slice order lifecycle → public surface → proof | The milestone closed cleanly with each later verifier depending on the earlier seam; the execution order matched the real dependency graph. | Still valid |
| D183 — keep M063 large-PR-first and same-process-first | The milestone delivered the target user-visible behavior and proof without expanding into distributed authority redesign. Cross-process durability remains a later-milestone concern rather than an M063 miss. | Still valid |
| D184 — extract lifecycle into a dedicated module | `verify:m063:s01` and the real handler path both depend on the pure lifecycle seam now; the extraction directly enabled safe S02/S03 proof work. | Still valid |
| D185 — canonical bounded first-pass comment owns continuation-visible updates | `verify:m063:s02` re-proved exactly one visible canonical surface with Review Details continuity and explicit revision/no-delta behavior. | Still valid |
| D186 — prove boundedness and stale-authority safety with deterministic verifiers plus targeted tests | `verify:m063:s03`, `verify:m063:s02`, and the TypeScript gate provided enough fresh evidence for milestone close without needing new runtime behavior. | Still valid |

## Success Criteria Results

- ✅ **A bounded large-PR first pass triggers automatic continuation without manual intervention.** Fresh milestone-close verification reran `bun run scripts/verify-m063-s01.ts --json` and returned `status_code: "m063_s01_ok"`; the `schedule-continuation` scenario reported `continuation-scheduled`, and the verifier also proved merge, quiet no-delta settlement, and stale-authority suppression on the real continuation seam.
- ✅ **Continuation updates the same visible review surface rather than creating an additional public lifecycle comment.** Fresh milestone-close verification reran `bun run verify:m063:s02 -- --json` and every scenario reported `visibleSurfaceCount: 1` and `continuationSurfaceCount: 0`, with passing `same-surface-ownership` and `marker-continuity` checks.
- ✅ **Continuation revisions are explicit and legible on that same surface rather than silent rewrites.** The fresh `verify:m063:s02` run returned `same-surface-revised` for the merge-revisions scenario with `revisionVisible: true`, and `same-surface-quiet-settlement` for no-delta settlement with no public churn.
- ✅ **Continuation prompt/context is measurably narrower than the first pass and remains sufficient-but-bounded.** Fresh milestone-close verification reran `bun run verify:m063:s03 -- --json`; both scenarios passed `narrowing-sections`, `first-pass-only-sections-omitted`, `boundedness-wording`, and `exhaustive-claim-absent`, with changed-file scope narrowing from 6 files on first pass to 2 on continuation.
- ✅ **Authoritative publish-rights checks still block stale continuation from overwriting newer review state on the shipped M063 paths.** `verify:m063:s01` returned `continuation-authority-suppressed` for the stale-authority scenario, and S03 slice evidence plus fresh `verify:m063:s02`/`verify:m063:s03` reruns preserved the same canonical-surface contract and bounded same-surface completion behavior used by the strengthened retry-path handler tests.

## Definition of Done Results

- ✅ **All roadmap slices are complete.** `gsd_milestone_status` reports S01, S02, and S03 all have status `complete`, with task counts 3/3 done for each slice.
- ✅ **All slice summaries exist.** `find .gsd/milestones/M063/slices -maxdepth 2 -name 'S*-SUMMARY.md' | sort` returned `.gsd/milestones/M063/slices/S01/S01-SUMMARY.md`, `.gsd/milestones/M063/slices/S02/S02-SUMMARY.md`, and `.gsd/milestones/M063/slices/S03/S03-SUMMARY.md`.
- ✅ **The milestone produced shipped code, not only planning artifacts.** Diffing the milestone code range from pre-M063 commit `5c45b10c5ddfcf2e58e1d392df6597d442f0b5a0` to `HEAD` showed non-`.gsd/` changes across 14 files including `src/handlers/review.ts`, `src/lib/review-continuation-lifecycle.ts`, `src/lib/partial-review-formatter.ts`, `src/execution/review-prompt.test.ts`, and all three verifier scripts.
- ✅ **Cross-slice integration works at milestone close.** Fresh reruns of `scripts/verify-m063-s01.ts --json`, `bun run verify:m063:s02 -- --json`, `bun run verify:m063:s03 -- --json`, and `bun run tsc --noEmit` all succeeded, proving the lifecycle seam, same-surface publication contract, bounded continuation proof, and clean TypeScript integration still hold together at close.
- ℹ️ **Horizontal Checklist.** No horizontal checklist was present in the roadmap, so there were no additional horizontal items to audit.

## Requirement Outcomes

- **R062:** Remains validated. Existing requirement evidence was corroborated at milestone close by a fresh `scripts/verify-m063-s01.ts --json` run returning `status_code: "m063_s01_ok"`, including `continuation-scheduled` and `continuation-authority-suppressed` scenarios.
- **R063:** Remains validated. Fresh `bun run verify:m063:s02 -- --json` rerun preserved one visible canonical surface and zero continuation-only surfaces across pending, revised, and quiet-settlement scenarios.
- **R065:** Remains validated. The same fresh `verify:m063:s02` rerun preserved explicit revision visibility for meaningful deltas and quiet no-delta settlement without public churn.
- **R066:** Remains validated. Fresh `bun run verify:m063:s03 -- --json` rerun preserved measurable narrowing, required-section preservation, truthful boundedness wording, and absence of exhaustive-coverage claims.
- **Status transitions:** No additional requirement status transitions were needed during milestone close because R062, R063, R065, and R066 had already been advanced to `validated` during slice close with recorded evidence in `.gsd/REQUIREMENTS.md`.

## Deviations

None. Milestone-close verification confirmed the shipped work matched the roadmap: lifecycle extraction first, same-surface revision behavior second, and boundedness/authority-safe proof third.

## Follow-ups

M064 or later should address durable cross-process continuation authority/coordination and any rollout telemetry hardening beyond the same-process proof scope delivered here.

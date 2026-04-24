---
id: M064
title: "Continuation state, supersession, and operator evidence"
status: complete
completed_at: 2026-04-24T08:18:36.246Z
key_decisions:
  - D187 — Store continuation lifecycle truth in a dedicated canonical continuation-family table instead of checkpoint JSON or telemetry rows.
  - D188 — Keep `ReviewWorkCoordinator` as the runtime publish gate but project authority transitions into canonical continuation-family state for restart-safe durable truth.
  - D189 — Make operator-facing continuation evidence canonical-state-first: authoritative outcome, final stop reason, then authoritative attempt identity, with projection status reported explicitly.
key_files:
  - src/db/migrations/039-continuation-family-state.sql
  - src/db/migrations/039-continuation-family-state.down.sql
  - src/knowledge/store.ts
  - src/knowledge/store.test.ts
  - src/knowledge/types.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - src/execution/mcp/checkpoint-server.ts
  - src/execution/mcp/checkpoint-server.test.ts
  - src/knowledge/continuation-operator-evidence.ts
  - src/knowledge/continuation-operator-evidence.test.ts
  - scripts/verify-m064-s01.ts
  - scripts/verify-m064-s02.ts
  - scripts/verify-m064-s03.ts
  - package.json
lessons_learned:
  - Continuation-family lifecycle truth needs its own durable authority row; checkpoints and telemetry are projection/scratch surfaces and become misleading when overloaded as truth.
  - Supersession safety has to be enforced in canonical writes with authoritative ordinals, not inferred later from logs or coordinator memory.
  - Operator evidence becomes trustworthy only when report surfaces read canonical state directly and represent degraded or pending projections explicitly instead of hiding them.
---

# M064: Continuation state, supersession, and operator evidence

**M064 established canonical continuation-family state as the durable authority for continuation outcomes, supersession, stop reasons, checkpoint truthfulness, and operator evidence.**

## What Happened

M064 replaced rival continuation truth surfaces with one durable canonical continuation-family authority model keyed by `(familyKey, baseReviewOutputKey)`. S01 introduced the canonical lifecycle store, ordinal-guarded authority semantics, and the first verifier proving merged, quiet-settled, blocked, and superseded answers directly from durable state. S02 then pushed the real timeout/retry orchestration path through that canonical layer so retry enqueue failure, retry execution failure, telemetry projection degradation, stale supersession, and checkpoint durability acknowledgement all leave one truthful canonical record instead of scattered implicit state. S03 completed the operator-facing seam by resolving `reviewOutputKey` input into canonical continuation-family state and rendering authoritative outcome, stop reason, winning attempt, and projection status directly from that row in both JSON and human-readable forms. Fresh milestone-close verification re-ran the S03 operator-evidence suite and both upstream verifiers, confirming the assembled system delivers canonical-state-first truth across runtime, verifier, and operator report surfaces. Decision re-evaluation: D187 remains valid because a dedicated continuation-family lifecycle store cleanly separated authority from scratch checkpoints and telemetry. D188 remains valid because `ReviewWorkCoordinator` still gates runtime publication while canonical state now provides restart-safe durable authority. D189 remains valid because the shipped operator evidence reports authoritative outcome, stop reason, and attempt identity first, with degraded/pending projection status reported explicitly rather than redefining truth.

## Success Criteria Results

- ✅ **Canonical continuation-family state persists durably and directly answers final authoritative outcome, stop reason, and authoritative attempt identity.** S01 added `continuation_family_state` plus typed store/query seams (`src/db/migrations/039-continuation-family-state.sql`, `src/knowledge/store.ts`, `src/knowledge/types.ts`). Fresh evidence from `bun run verify:m064:s01 -- --json` returned `status_code: m064_s01_ok` with four passing scenarios whose answers came directly from canonical state, including `authoritativeAttemptId`, `authoritativeAttemptOrdinal`, `authoritativeOutcome`, and `finalStopReason`.
- ✅ **Superseded or late-finishing attempts cannot overwrite or ambiguate canonical lifecycle truth or the shipped same-surface publication contract.** S01 established ordinal-guarded writes and S02 hardened live retry/failure branches in `src/handlers/review.ts`. Fresh verification from `bun run verify:m064:s01 -- --json` showed `superseded-stale-attempt` preserving `review-work-3`, and `bun run verify:m064:s02 -- --json` showed `superseded-stale-retry` preserving `review-work-3` with `finalStopReason=superseded-by-newer-attempt`.
- ✅ **Checkpoint, telemetry, and reporting surfaces project from canonical state and degrade with explicit projection status instead of becoming rival truth sources.** S02 made `save_review_checkpoint` await durable persistence in `src/execution/mcp/checkpoint-server.ts`, and S03 added canonical-state-first operator evidence in `src/knowledge/continuation-operator-evidence.ts` plus `scripts/verify-m064-s03.ts`. Fresh verification showed `degraded-projection` and `pending-continuation` records rendered explicit `projectionStatus` values while preserving canonical lifecycle fields.
- ✅ **Operator proof surfaces can recover continuation truth deterministically without correlating scattered logs or ephemeral coordinator memory.** `bun run verify:m064:s03 -- --json` exited 0 with `status_code: m064_s03_ok` and six explicit records (canonical, degraded, pending, superseded, missing-row, invalid-key) derived from canonical continuation-family state; the human-readable `bun run verify:m064:s03` report rendered the same authoritative fields in operator order.

## Definition of Done Results

- ✅ **All roadmap slices are complete.** `gsd_milestone_status` reports S01, S02, and S03 all `status: complete`, each with 3/3 tasks done.
- ✅ **All slice summaries exist.** `find .gsd/milestones/M064 -maxdepth 3 \( -name 'S*-SUMMARY.md' -o -name 'M064-ROADMAP.md' \)` returned `.gsd/milestones/M064/slices/S01/S01-SUMMARY.md`, `.gsd/milestones/M064/slices/S02/S02-SUMMARY.md`, `.gsd/milestones/M064/slices/S03/S03-SUMMARY.md`, and `.gsd/milestones/M064/M064-ROADMAP.md`.
- ✅ **Milestone produced real code, not only planning artifacts.** Equivalent code-change verification `git diff --stat 604e7cc95c^ HEAD -- ':!.gsd/'` showed 18 non-`.gsd/` files changed including `src/handlers/review.ts`, `src/knowledge/store.ts`, `src/knowledge/continuation-operator-evidence.ts`, `src/execution/mcp/checkpoint-server.ts`, and the three M064 verifier scripts.
- ✅ **Cross-slice integration works.** Fresh end-to-end milestone-close verification passed: `bun test src/knowledge/continuation-operator-evidence.test.ts && bun test scripts/verify-m064-s03.test.ts && bun run verify:m064:s03 -- --json && bun run verify:m064:s03 && bun test scripts/verify-m064-s01.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s01 -- --json && bun run verify:m064:s02 -- --json`.
- ✅ **Horizontal checklist.** No horizontal checklist section was present in `M064-ROADMAP.md`, so there were no unchecked horizontal items to audit.

## Requirement Outcomes

- ✅ **R067 → validated.** Fresh M064/S01 evidence (`bun test src/handlers/review.test.ts` plus `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`) proved canonical supersession-safe writes preserve the newest authoritative attempt and block stale overwrites.
- ✅ **R071 → validated.** S01 verification proved canonical continuation-family rows answer merged, quiet-settled, blocked, and superseded lifecycle scenarios directly from durable state.
- ✅ **R072 → validated.** S01 verifier output exposed `authoritativeAttemptId` and `authoritativeAttemptOrdinal` directly from canonical state for all planned lifecycle scenarios.
- ✅ **R073 → validated.** S01 verifier output exposed controlled `finalStopReason` enums (`merged-continuation-results`, `settled-without-update`, `no-follow-up`, `superseded-by-newer-attempt`) directly from canonical state.
- ✅ **R074 → validated.** Fresh S03 verification (`bun test src/knowledge/continuation-operator-evidence.test.ts`, `bun test scripts/verify-m064-s03.test.ts`, `bun run verify:m064:s03 -- --json`, `bun run verify:m064:s03`, plus upstream S01/S02 verifiers) proved operator evidence renders explicit `projectionStatus` on top of canonical lifecycle truth.
- ✅ **R075 → validated.** Fresh S02 verification (`bun test src/execution/mcp/checkpoint-server.test.ts && bun test src/handlers/review.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s02 -- --json`) proved checkpoint acknowledgements wait for durable save completion and never falsely report `saved: true` on failure.

## Deviations

None.

## Follow-ups

M065 should use the canonical continuation-family authority/report seam for live large-PR rollout proof so production operator evidence and public lifecycle behavior stay aligned with the durable truth model established here.

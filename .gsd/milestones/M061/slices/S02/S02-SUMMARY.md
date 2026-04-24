---
id: S02
parent: M061
milestone: M061
provides:
  - A lighter default mention.response path that stages heavy context only when request shape warrants it.
  - Stable operator-visible prompt-section evidence for conversational mention reduction.
  - A reusable admission-policy seam that downstream slices can build on when compacting review prompts and caching derived context.
requires:
  []
affects:
  - S03
  - S04
  - S05
key_files:
  - src/handlers/mention.ts
  - src/execution/mention-context.ts
  - src/execution/config.ts
  - src/execution/mention-prompt.ts
  - src/handlers/mention.test.ts
  - src/execution/mention-context.test.ts
  - src/execution/mention-prompt.test.ts
  - scripts/usage-report.ts
  - scripts/verify-m061-s01.ts
  - scripts/verify-m061-s02.ts
  - scripts/usage-report.test.ts
  - scripts/verify-m061-s01.test.ts
  - scripts/verify-m061-s02.test.ts
  - package.json
key_decisions:
  - Use a single request-shape-derived admission policy to drive mention prompt context, retrieval shaping, code-pointer admission, and PR diff prefetch together.
  - Represent mention context cost with fine-grained stable `mention.context` section names so prompt reduction can be proven on the canonical telemetry surface.
  - Fail open when a mention-context section fetch fails by dropping only that section and preserving the overall mention response.
  - Keep S02 proof/reporting on the existing S01 telemetry/report seam instead of introducing a second measurement system.
patterns_established:
  - Shared request-shape admission policy should control both prompt context and upstream expensive data gathering to avoid cosmetic-only prompt diets.
  - Prompt-cost reduction proof should depend on stable named prompt sections rather than raw prompt capture or slice-local metrics.
  - Operator proof scripts should fail open with explicit database access state when Postgres telemetry is unavailable.
observability_surfaces:
  - Fine-grained `mention.context` section names in prompt-section telemetry.
  - Canonical `mention.user-prompt` accounting preserved for conversational mention proofing.
  - `scripts/usage-report.ts` and `scripts/verify-m061-s02.ts` expose fail-open operator inspection for the S02 reduction path.
drill_down_paths:
  - .gsd/milestones/M061/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M061/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M061/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-24T01:49:50.429Z
blocker_discovered: false
---

# S02: S02

**Implemented staged mention-context admission so ordinary mention.response flows stay light by default while explicit review mentions retain rich context and the same canonical prompt-section proof surface records the reduction.**

## What Happened

This slice turned mention request shape into a shared admission policy and threaded it through the full conversational mention path. The handler now distinguishes ordinary conversational mentions from explicit review, code-seeking, and diff-seeking requests, then uses that policy to decide whether to admit conversation history, PR metadata, review-thread context, candidate issue code pointers, and PR diff prefetch. Mention context construction now emits fine-grained `mention.context` section names instead of one coarse bucket, and section fetch failures fail open by dropping only the affected section while preserving the mention reply. Retrieval shaping now follows the same policy so light conversational flows no longer inherit rich derived inputs just because richer context exists elsewhere. On the operator side, the slice kept S01’s canonical Postgres/report proof path, added a discoverable `verify:m061:s02` script alias, and preserved fail-open reporting semantics so prompt-section reduction remains inspectable through the same telemetry surface rather than a parallel metric system. During slice verification, all planned test suites passed, the exported usage/proof CLI surfaces produced the expected fail-open JSON when no database URL was present, and direct Bun script entrypoints were observed to hang in this harness even though the exported CLI helpers behaved correctly; that entrypoint quirk is recorded as a limitation rather than a blocker because the tested canonical proof logic still works.

## Verification

Slice-plan verification passed on the current workspace. `bun test ./src/execution/mention-context.test.ts ./src/execution/mention-prompt.test.ts ./src/handlers/mention.test.ts` passed with 169 tests covering light default mention context, preserved explicit-review richness, request-shape gating for candidate code pointers and PR diffs, and retrieval-input staging. `bun test ./scripts/usage-report.test.ts ./scripts/verify-m061-s01.test.ts ./scripts/verify-m061-s02.test.ts` passed with 12 tests covering canonical prompt-section reporting, S01 baseline proof, and the new S02 mention-context proof including fail-open DB behavior. Operational proof surfaces were exercised directly with `bun -e` imports: `runM061S02MentionContextProofCli(['--json'], {})` returned the expected fail-open preflight payload (`databaseAccess: missing`) and `runUsageReportCli(['--json'], {})` returned the expected fail-open report summary, confirming the telemetry/report seam remains the canonical inspection surface. `bun run verify:m061:s02 --json` timed out under this agent bash harness after printing `$ bun scripts/verify-m061-s02.ts --json`; this reproduces the task-level known issue that direct Bun entrypoints can stall here even while the exported CLI helpers and tests succeed.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

The planned S02 proof files already existed by the time T03 ran, so the work validated and hardened the existing proof/report implementation rather than creating it from scratch. Slice verification also reproduced a harness-specific Bun entrypoint hang for direct script execution; the exported CLI helpers and tests remained the authoritative proof surface.

## Known Limitations

Direct Bun entrypoints for `scripts/verify-m061-s02.ts` and `scripts/usage-report.ts` can hang under this agent bash harness even though the exported CLI helper functions return immediately and the automated tests pass. No live Postgres telemetry was available in this auto-mode environment, so slice-level proof was limited to fail-open reporting behavior plus test coverage rather than a populated runtime dataset.

## Follow-ups

S03 should apply the same budget-conscious discipline to review prompt assembly, using the stable prompt-section accounting established here. The Bun entrypoint hang should be investigated separately so operator-facing package-script execution is as reliable in automation as the exported CLI helper path.

## Files Created/Modified

- `src/handlers/mention.ts` — Derived and applied a shared mention admission policy across prompt context, code-pointer gating, PR diff prefetch, and retrieval shaping.
- `src/execution/mention-context.ts` — Added admission-policy-aware staged context building, fine-grained prompt-section telemetry, and fail-open section omission behavior.
- `src/execution/config.ts` — Added and validated configurable mention admission defaults.
- `src/execution/mention-prompt.ts` — Consumed the staged mention context while preserving the canonical `mention.user-prompt` accounting surface.
- `src/handlers/mention.test.ts` — Added regression coverage for light conversational paths, preserved explicit review behavior, and staged retrieval inputs.
- `src/execution/mention-context.test.ts` — Pinned fine-grained mention section telemetry, light default behavior, explicit-review richness, and fail-open omission behavior.
- `src/execution/mention-prompt.test.ts` — Pinned omission of heavy headings on ordinary mentions and stable user-prompt accounting.
- `scripts/usage-report.ts` — Preserved the canonical telemetry report surface and lazy DB loading for fail-open behavior.
- `scripts/verify-m061-s01.ts` — Kept the baseline proof path aligned with the shared telemetry/report seam.
- `scripts/verify-m061-s02.ts` — Verified fine-grained mention-context attribution and canonical user-prompt accounting through the operator proof path.
- `package.json` — Added the discoverable `verify:m061:s02` script alias for rerunning the slice proof.

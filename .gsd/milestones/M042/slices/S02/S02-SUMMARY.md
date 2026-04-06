---
id: S02
parent: M042
milestone: M042
provides:
  - Prompt author-experience rendering that keeps established and senior contributors out of newcomer/developing guidance.
  - Review Details rendering with an explicit `Author tier:` line and truthful guidance labels derived from the resolved tier.
  - A reusable M042/S02 proof harness that composes contributor-profile precedence with prompt/details rendering and the CrystalP-shaped repro case.
requires:
  - slice: S01
    provides: Corrected contributor-tier persistence and the contributor-profile → cache → fallback precedence contract that S02 renders into user-visible surfaces.
affects:
  - S03
key_files:
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - scripts/verify-m042-s02.ts
  - scripts/verify-m042-s02.test.ts
  - package.json
  - .gsd/PROJECT.md
key_decisions:
  - Kept the existing `buildAuthorExperienceSection()` taxonomy mapping and strengthened regression guards around rendered output instead of redesigning contributor tiers in S02.
  - Made Review Details author-tier wording explicit (`developing`, `established contributor guidance`, `senior contributor guidance`) so truthfulness is visible in the rendered body rather than inferred from generic fallback wording.
  - Built the slice proof harness on production seams (`resolveAuthorTierFromSources`, `buildReviewPrompt`, `formatReviewDetailsSummary`) with stable check IDs and banned-phrase guards rather than fixture-only duplicate logic.
  - Documented the current handler-seam limitation honestly: the existing `runProfileScenario()` path does not yet prove established/senior wording end to end, so deterministic render-helper proof remains the authoritative S02 verification surface.
patterns_established:
  - Render-surface truthfulness should be asserted on the full rendered body, with required-phrase and banned-phrase checks, not on proxy fields or indirect metadata.
  - When a user-visible wording contract depends on higher-fidelity persisted state, keep the state-precedence helper pure and test it separately from the render helpers; then add a slice verifier that composes those production seams.
  - A deterministic proof harness with stable check IDs is the right place to lock cross-surface wording invariants that would be awkward or brittle to express through a larger orchestration test seam.
observability_surfaces:
  - `bun run verify:m042:s02` is now the durable regression surface for review-surface contributor-tier truthfulness; it emits four named checks in both text and JSON forms and can be rerun unchanged by S03 and milestone closure.
drill_down_paths:
  - .gsd/milestones/M042/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M042/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M042/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-06T22:53:44.907Z
blocker_discovered: false
---

# S02: Review-Surface Truthfulness Wiring

**Review prompt and Review Details surfaces now render explicit contributor-tier guidance from the corrected contributor-profile source, and a dedicated M042/S02 proof harness locks established-tier output away from newcomer/developing regressions.**

## What Happened

S02 consumed the persistence-first fix delivered in S01 and wired that corrected contributor-tier state into the main review surfaces instead of adding new fallback heuristics. T01 hardened `src/execution/review-prompt.test.ts` around the existing `buildAuthorExperienceSection()` taxonomy seam. The slice kept the established/senior wording model intact and added direct full-section assertions plus banned-phrase guards so higher-tier contributors cannot silently regress back to newcomer or developing guidance in prompt output.

T02 made the Review Details surface equally explicit. `src/lib/review-utils.ts` now renders a concrete `Author tier:` line with guidance labels (`developing`, `established contributor guidance`, `senior contributor guidance`) instead of a weaker generic author label. Focused formatter tests prove the rendered Review Details body carries the correct tier wording and excludes newcomer/developing phrasing for established and senior cases. The handler test suite remains green, but one important limit remains: the existing `runProfileScenario()` seam still does not prove established/senior contributor wording all the way through a live review run. That is a test-harness gap, not a failing code path surfaced by verification, and it is called out explicitly rather than hidden.

T03 added a durable slice verifier in `scripts/verify-m042-s02.ts`, registered as `bun run verify:m042:s02`. The harness uses production seams — `resolveAuthorTierFromSources()`, `buildReviewPrompt()`, and `formatReviewDetailsSummary()` — to assert four behavioral invariants: contributor-profile tier wins over cache/fallback, established-tier prompt guidance stays truthful, Review Details established-tier wording stays truthful, and the CrystalP-shaped repro keeps both surfaces established while excluding newcomer and developing phrases. The result is a reusable proof surface for milestone closure and for S03 regression work.

This slice therefore delivered the core S02 contract at the render-helper and slice-verifier level: the corrected contributor-profile tier now drives user-visible prompt/details wording, and the known CrystalP-shaped regression is locked out of those surfaces. The remaining work is not wording design; it is cache/fallback hardening and stronger orchestration-path proof in S03.

## Verification

Ran all slice-plan verification commands and all passed.

- `bun test ./src/execution/review-prompt.test.ts` → 211 pass, 0 fail
- `bun test ./src/lib/review-utils.test.ts` → 4 pass, 0 fail
- `bun test ./src/handlers/review.test.ts` → 76 pass, 0 fail
- `bun test ./scripts/verify-m042-s02.test.ts` → 14 pass, 0 fail
- `bun run verify:m042:s02` → PASS; all 4 checks passed
- `bun run tsc --noEmit` → exit 0, no output

The proof harness passed these checks:
- `M042-S02-PROFILE-TIER-DRIVES-SURFACE`
- `M042-S02-PROMPT-ESTABLISHED-TRUTHFUL`
- `M042-S02-DETAILS-ESTABLISHED-TRUTHFUL`
- `M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED`

No additional observability surface was introduced in this slice beyond the deterministic proof harness, and that harness executed successfully.

## Requirements Advanced

- R037 — Advanced the truthful review-surface side of contributor-context rendering by making prompt/details wording consume the corrected contributor-profile tier source explicitly instead of generic fallback wording.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T02 planned to reuse the existing captured handler harness to prove one review run threads the resolved author tier into both user-visible surfaces. In practice, the existing `runProfileScenario()` seam still did not drive established/senior contributor output truthfully enough to serve as that end-to-end assertion. Rather than ship a misleading green test, the slice kept handler coverage scoped to the stable seam, strengthened deterministic formatter coverage in `src/lib/review-utils.test.ts`, and documented the orchestration-path proof gap for S03.

## Known Limitations

The existing `runProfileScenario()` handler seam still does not prove established/senior contributor wording through a full live review execution path. S02 proves the contributor-profile precedence helper plus the production render helpers, and the handler suite remains green, but the strongest end-to-end handler-level author-tier assertion is still missing.

The M042/S02 proof harness exercises production seams, but it is still a slice-level deterministic harness, not a full GitHub-comment publication flow. Cache reuse and degraded fallback behavior are also intentionally out of scope here; S03 needs to verify those paths cannot reintroduce stale low-tier labeling.

## Follow-ups

S03 should harden cache reuse and fallback classification so repeated or degraded review runs cannot drift back to newcomer/developing wording after S01/S02 corrected the source-of-truth and render layers.

S03 should also extend handler-level proof so at least one live review execution seam demonstrates established/senior contributor wording end to end, closing the gap called out in T02 rather than relying solely on precedence + render-helper assertions.

## Files Created/Modified

- `src/execution/review-prompt.test.ts` — Added full rendered-section regression guards proving established and senior prompt guidance excludes newcomer/developing wording.
- `src/lib/review-utils.ts` — Changed Review Details rendering to include an explicit `Author tier:` line with concrete guidance labels for developing, established, and senior contributors.
- `src/lib/review-utils.test.ts` — Added deterministic Review Details regression coverage for regular, established, and senior tier wording.
- `src/handlers/review.test.ts` — Kept the handler suite green and documented the current limitation of the existing `runProfileScenario()` seam rather than shipping brittle overclaims.
- `scripts/verify-m042-s02.ts` — Added the M042/S02 proof harness with four stable checks covering precedence, prompt truthfulness, Review Details truthfulness, and the CrystalP-shaped regression case.
- `scripts/verify-m042-s02.test.ts` — Added harness tests for pass/fail behavior, JSON/text output, and failure-summary reporting.
- `package.json` — Registered `verify:m042:s02` so the slice proof harness is runnable from the standard script surface.
- `.gsd/PROJECT.md` — Refreshed project state to reflect completed M042/S02 work and the remaining S03 cache/fallback hardening scope.

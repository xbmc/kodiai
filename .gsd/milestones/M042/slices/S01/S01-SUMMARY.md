---
id: S01
parent: M042
milestone: M042
provides:
  - Deterministic reproduction of the stale-tier defect and regression coverage that proves score advancement previously failed to advance stored contributor tiers.
  - A shared percentile recalculation path that persists corrected contributor tiers during incremental expertise updates.
  - An explicit review author-tier precedence contract in which contributor-profile state outranks cache and fallback classification.
  - A named slice proof harness (`bun run verify:m042:s01`) that downstream slices can reuse as the baseline contributor-tier truthfulness contract.
requires:
  []
affects:
  - S02
  - S03
key_files:
  - src/contributor/expertise-scorer.ts
  - src/contributor/expertise-scorer.test.ts
  - src/contributor/tier-calculator.ts
  - src/contributor/tier-calculator.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - scripts/verify-m042-s01.ts
  - scripts/verify-m042-s01.test.ts
  - package.json
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
  - .gsd/PROJECT.md
key_decisions:
  - Recalculate and persist contributor tiers inside scorer update paths instead of patching review wording around stale profile state.
  - Centralize percentile tier logic in tier-calculator and call it from a scorer-local fail-open seam so incremental updates and batch recalculation share one contract.
  - Resolve review author tier through an explicit contributor-profile → cache → fallback precedence helper rather than implicit branching inside the review handler.
  - Keep the slice verifier focused on behavioral invariants instead of fixture-specific absolute tiers so future percentile tuning does not create false failures while the truthfulness contract still holds.
patterns_established:
  - Persistence-first contributor truthfulness: fix stale contributor-tier state at score-update time rather than patching review-surface wording around bad stored data.
  - Shared percentile contract: scorer-side single-profile recalculation and batch tier recalculation both reuse the same `tier-calculator` helpers so tier taxonomy stays centralized.
  - Pure precedence seam: extract source-selection helpers like `resolveAuthorTierFromSources()` when review behavior needs focused regression coverage without full handler orchestration.
  - Fail-open enrichment rule: background contributor-tier recalculation may degrade to the existing stored tier, but it must log the failure and never block review completion.
observability_surfaces:
  - `recalculateTierFailOpen()` emits a structured warning with `profileId`, `updatedOverallScore`, and `fallbackTier` when percentile recalculation degrades, which is the durable failure signal for scorer-side tier truthfulness.
  - `bun run verify:m042:s01` is now the authoritative slice proof surface; it prints four named checks and JSON output that downstream slices and milestone closure can rerun unchanged.
drill_down_paths:
  - .gsd/milestones/M042/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M042/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M042/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-06T22:36:46.831Z
blocker_discovered: false
---

# S01: Repro and Tier-State Correction

**Contributor score updates now recalculate and persist truthful contributor tiers, and review-tier resolution explicitly trusts corrected profile state ahead of cache and fallback classification.**

## What Happened

S01 started by proving the defect directly instead of guessing at review-surface symptoms. The scorer path in `src/contributor/expertise-scorer.ts` was shown to recompute `overallScore` and still persist `profile.overallTier` unchanged, which made a CrystalP-shaped contributor look like a newcomer even after their score had advanced out of the lowest cohort. T01 added deterministic fake-store regressions around `updateExpertiseIncremental()` plus a scorer-local `deriveUpdatedOverallScore()` seam so the stale-tier write contract could be asserted without routing through the review handler or a database integration.

With the defect reproduced, T02 fixed the source of truth. Shared percentile assignment logic was extracted and anchored in `src/contributor/tier-calculator.ts`, and scorer updates now call `recalculateTierFailOpen()` after the updated `overallScore` is known. That means incremental updates persist a recalculated contributor tier derived from the current score distribution instead of blindly reusing the stored tier. The recalculation seam is explicitly fail-open: if the score snapshot read or calculation path fails, the scorer logs a warning and persists the existing tier so review-time background updates remain non-blocking.

T03 then made the review path consume that corrected state explicitly. `src/handlers/review.ts` now exposes a pure `resolveAuthorTierFromSources()` helper whose contract is contributor profile first, then author cache, then fallback classification. Focused handler tests prove the precedence behavior directly. The slice also added `scripts/verify-m042-s01.ts` and its test coverage, giving the milestone a reusable named proof surface for four invariants: the stuck-tier repro is fixed, recalculated tier persistence is truthful, contributor-profile state outranks cache/fallback, and recalculation degradation stays fail-open rather than becoming review-blocking.

One small pre-existing cleanup surfaced during verification: `bun run tsc --noEmit` exposed a duplicate-property helper issue in `src/contributor/expertise-scorer.test.ts`. Fixing that kept the repo-level typecheck green, which matters because the slice plan explicitly required a clean type gate.

## Verification

Passed all planned slice verification gates: `bun test ./src/contributor/expertise-scorer.test.ts`, `bun test ./src/contributor/tier-calculator.test.ts`, `bun test ./src/handlers/review.test.ts`, `bun test ./scripts/verify-m042-s01.test.ts`, `bun run verify:m042:s01`, and `bun run tsc --noEmit`. The slice verifier reported four passing checks: `M042-S01-STUCK-TIER-REPRO-FIXED`, `M042-S01-RECALCULATED-TIER-PERSISTS`, `M042-S01-PROFILE-PRECEDENCE`, and `M042-S01-FAIL-OPEN-NONBLOCKING`.

## Requirements Advanced

- R037 — Established the persistence-time and review-resolution contracts needed for truthful contributor experience labeling in M042: stored contributor tiers now advance when scores advance, and review resolution prefers that corrected state ahead of lower-fidelity cache and fallback sources.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

This slice corrects stored contributor-tier advancement and source precedence, but it does not yet audit every review-surface wording path for newcomer-style copy; that belongs to S02. It also does not yet prove cache reuse and degraded fallback paths preserve the corrected contributor tier across repeated review executions; that belongs to S03.

## Follow-ups

S02 should wire the corrected contributor-profile tier through all review-surface wording and summary generation paths so no newcomer-style guidance survives when the stored profile has already advanced. S03 should verify cache reuse and degradation paths cannot reintroduce stale low-tier labeling after the source-of-truth fix.

## Files Created/Modified

- `src/contributor/expertise-scorer.ts` — Added scorer-local overall-score helper and fail-open tier recalculation so incremental contributor updates persist truthful tiers from the shared percentile distribution.
- `src/contributor/expertise-scorer.test.ts` — Expanded scorer regressions to prove the stale-tier defect, truthful tier advancement, and fail-open persistence fallback under controlled score distributions.
- `src/contributor/tier-calculator.ts` — Extracted canonical percentile assignment helpers used by both batch tier recalculation and scorer-side per-profile recalculation.
- `src/contributor/tier-calculator.test.ts` — Added shared percentile-contract tests for targeted profile reassignment and batch tier recalculation.
- `src/handlers/review.ts` — Exported a pure author-tier precedence helper so review resolution explicitly trusts contributor-profile state before cache and fallback classification.
- `src/handlers/review.test.ts` — Added focused precedence tests covering contributor-profile, cache, and fallback author-tier source selection.
- `scripts/verify-m042-s01.ts` — Added the named slice verifier covering stuck-tier repro repair, persisted recalculation, contributor-profile precedence, and fail-open non-blocking behavior.
- `scripts/verify-m042-s01.test.ts` — Added verifier tests for the M042/S01 proof harness.
- `package.json` — Registered the slice verifier command for downstream proof and milestone closure reuse.
- `.gsd/KNOWLEDGE.md` — Recorded the new persistence-first contributor-tier truthfulness pattern for future slices.
- `.gsd/DECISIONS.md` — Recorded the slice-level architecture decision that contributor-tier truthfulness is enforced at score persistence time and consumed by review precedence.
- `.gsd/PROJECT.md` — Refreshed current project state to reflect completed M042/S01 and remaining M042 work.

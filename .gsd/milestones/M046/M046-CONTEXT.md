---
depends_on: [M045]
---

# M046: Contributor Tier Calibration and Fixture Audit

**Gathered:** 2026-04-08
**Status:** Queued — pending auto-mode execution.

## Project Description

Build the evidence base for contributor-tier calibration using real `xbmc/xbmc` contributor samples, then evaluate whether Kodiai’s scoring, percentile tiering, and refresh behavior match reality under the product contract established by M045. This milestone is the implementation-oriented answer to issue #78: it should produce fixtures, measurement, and explicit calibration conclusions rather than hand-wavy “the model seems okay.”

## Why This Milestone

Once M045 settles what contributor experience is supposed to do, Kodiai still needs to know whether the current model actually maps contributors into those behaviors correctly. Right now `src/contributor/expertise-scorer.ts` uses weighted decayed signals (`commit=1`, `pr_review=2`, `pr_authored=3`) and `src/contributor/tier-calculator.ts` assigns stored tiers by percentile bands. Issue #78 is about whether those signals, thresholds, refresh rules, and sample fixtures match real `xbmc/xbmc` contributor distribution — not just whether one mislabeling bug was fixed.

## User-Visible Outcome

### When this milestone is complete, the user can:

- inspect a concrete xbmc/xbmc contributor fixture set and see whether Kodiai’s contributor-tier assignments are structurally plausible.
- answer whether the current contributor scoring/tiering model is sound, needs retuning, or needs replacement under the M045 product contract.

### Entry point / environment

- Entry point: contributor-profile scoring/tiering code, fixture datasets, and verification harnesses.
- Environment: local dev with repo-backed sample analysis; production behavior need not change yet unless a minimal corrective implementation is required by the chosen contract.
- Live dependencies involved: GitHub contributor history or stored contributor-profile data, local verification scripts/tests.

## Completion Class

- Contract complete means: Kodiai has a repeatable xbmc/xbmc-first contributor calibration method with explicit sample fixtures and verdicts.
- Integration complete means: the scoring model, tier calculator, and refresh/update path can be evaluated against the chosen contributor-experience contract rather than in isolation.
- Operational complete means: the project can state whether recalibration is required, and if so, exactly what needs changing next.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- a real xbmc/xbmc contributor sample set exists and is reusable for calibration checks.
- Kodiai can explain, with evidence, whether its current weighted signals, percentile tiers, and update timing are aligned with the M045 contract.
- the outcome is explicit: keep-as-is, retune, or replace — not “needs more thought.”

## Risks and Unknowns

- The calibration answer may reveal that percentile tiering itself is the wrong mechanism, not just that the cutoffs are off.
- Sample contributors may cluster around a few obvious cases and fail to stress the ambiguous middle bands.
- If the model is structurally unsound, this milestone must resist doing ad-hoc parameter tweaks just to make fixtures pass.

## Existing Codebase / Prior Art

- `src/contributor/expertise-scorer.ts` — verified against current codebase state; derives decayed scores from weighted activity signals and updates overall score incrementally.
- `src/contributor/tier-calculator.ts` — verified against current codebase state; assigns stored contributor tiers by percentile distribution with `newcomer / developing / established / senior` buckets.
- `src/contributor/types.ts` — verified against current codebase state; contributor profiles persist `overallTier`, `overallScore`, and expertise dimensions.
- `src/handlers/review.ts` — verified against current codebase state; review-time tier resolution prefers contributor profiles, then author cache, then low-fidelity fallback classification.
- `src/handlers/review.test.ts` — verified against current codebase state; already contains contributor-tier precedence and contradiction tests that provide regression seams.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R047 — this milestone provides the fixture-driven calibration proof for the contributor-tier model on xbmc/xbmc.

## Scope

### In Scope

- define the xbmc/xbmc contributor sample set used as calibration truth.
- evaluate current weighted signals, percentile cutoffs, and refresh/update timing against those fixtures.
- create repeatable calibration checks or reports that can be rerun as the model changes.
- produce an explicit recommendation for what M047 must change in the live system.

### Out of Scope / Non-Goals

- broad cross-repo calibration from the start.
- redesigning review tone or surface behavior independently of the contract decided in M045.
- shipping the full user-facing rollout of recalibrated behavior — that belongs to M047.

## Technical Constraints

- `xbmc/xbmc` is the primary truth set for fixtures and calibration evidence.
- Calibration must be evaluated against the product contract from M045, not against the old mixed-taxonomy behavior by default.
- The milestone must distinguish “parameter retune” from “model/architecture replacement needed.”

## Integration Points

- contributor scoring / expertise update path.
- tier calculation and persistence.
- review-time tier resolution and cache fallback logic.
- any fixture/report harness introduced to make calibration repeatable.

## Open Questions

- What contributor sample set best covers clear seniors, clear newcomers, and ambiguous middle cases? — Current thinking: a curated xbmc/xbmc-first fixture set, not a random sweep alone.
- Should recalculation happen on every meaningful update, on a schedule, or both? — Current thinking: evaluate explicitly rather than assume the current path is enough.
- If percentile bands are wrong, is the answer new cutoffs or a different mechanism entirely? — Current thinking: the milestone must leave that conclusion explicit for M047.

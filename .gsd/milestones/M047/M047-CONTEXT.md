---
depends_on: [M045, M046]
---

# M047: Contributor Experience Redesign and Calibration Rollout

**Gathered:** 2026-04-08
**Status:** Queued — pending auto-mode execution.

## Project Description

Implement the contributor-experience redesign and contributor-tier recalibration chosen by M045 and M046, then roll that behavior through the live tier-related surfaces with end-to-end proof. This milestone is where the decisions stop being theory and start being the shipped behavior users actually see.

## Why This Milestone

M045 and M046 are intentionally decision-heavy: they define what contributor experience should mean and whether the current model matches reality. The actual product value arrives only when Kodiai’s live surfaces behave according to those conclusions. Today the contributor model is split across review prompt shaping, Review Details output, retrieval query hints, Slack profile display, contributor profile persistence, and fallback cache logic. M047 is the milestone that makes those pieces consistent.

## User-Visible Outcome

### When this milestone is complete, the user can:

- watch Kodiai produce contributor-experience behavior that matches the new contract across the shipped tier-related surfaces.
- trust that the contributor model used by reviews, retrieval hints, and Slack profile output is the same model, not a mix of old and new semantics.

### Entry point / environment

- Entry point: GitHub PR reviews, Slack `/kodiai profile`, retrieval/query shaping, and contributor-model persistence/update flows.
- Environment: local verification plus production-like integration checks.
- Live dependencies involved: GitHub review flow, Slack slash-command profile flow, contributor profile store, retrieval pipeline.

## Completion Class

- Contract complete means: the live behavior matches the explicit contributor-experience contract from M045 and the calibration conclusions from M046.
- Integration complete means: all in-scope tier-related surfaces consume a coherent contributor model and no longer drift by taxonomy or wording.
- Operational complete means: the rollout is proven with end-to-end checks and regression tests, not just isolated unit changes.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- GitHub review behavior, Review Details, retrieval query shaping, and Slack profile output all reflect the same shipped contributor model.
- the calibrated tier logic or its replacement produces the expected outcomes for the real fixture set established in M046.
- at least one end-to-end scenario proves the system no longer exhibits the old mixed-taxonomy / mismatched-surface behavior.

## Risks and Unknowns

- Hidden coupling between contributor-profile tiers, fallback cache tiers, and review-surface wording may cause partial rollouts that appear correct in one surface and wrong in another.
- Retrieval/query behavior may need softer treatment than prompt/output behavior; over-rotating can reduce retrieval quality.
- Slack profile output may lag behind architecture changes if the rollout only focuses on review behavior.

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — verified against current codebase state; central integration point for contributor tier resolution and review-surface behavior.
- `src/execution/review-prompt.ts` — verified against current codebase state; tier-specific author-experience instructions materially shape review tone.
- `src/lib/review-utils.ts` — verified against current codebase state; Review Details exposes author tier and tone labeling directly.
- `src/knowledge/retrieval-query.ts` and `src/knowledge/multi-query-retrieval.ts` — verified against current codebase state; author tier feeds retrieval query formulation.
- `src/slack/slash-command-handler.ts` — verified against current codebase state; Slack profile output exposes contributor tier and score.
- `src/contributor/*` — verified against current codebase state; contributor profile storage, expertise scoring, and tier calculation are already modular enough to accept a redesign or retune.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R048 — this milestone ships the redesigned/recalibrated contributor-experience behavior coherently across all in-scope tier surfaces.

## Scope

### In Scope

- implement the chosen contributor-experience contract across review, retrieval, Slack, and model-plumbing surfaces.
- apply the calibrated tier model or replacement mechanism selected by M046.
- add end-to-end verification proving surface coherence and fixture correctness.
- remove or constrain obsolete taxonomy/behavior paths that would reintroduce drift.

### Out of Scope / Non-Goals

- reopening the product decision from M045 without new evidence.
- recalibration experiments that are not grounded in the M046 fixture/evidence base.
- expanding contributor personalization beyond the tier-related surfaces already chosen for this rollout.

## Technical Constraints

- M047 depends on both the product contract from M045 and the calibration verdict from M046.
- All tier-related surfaces remain in scope unless M045 explicitly removes one from the contract.
- The rollout must preserve truthful fail-open behavior when contributor data is unavailable or stale.

## Integration Points

- review handler and review prompt.
- Review Details formatting/output.
- contributor scoring, persistence, and fallback cache behavior.
- retrieval query construction.
- Slack profile display.

## Open Questions

- Which obsolete taxonomy names or compatibility paths should be deleted versus translated? — Current thinking: only keep compatibility where it preserves clarity rather than hiding drift.
- How should fail-open behavior look when contributor data is missing under the new model? — Current thinking: must stay explicit and non-patronizing.
- What production-like proof is enough to show cross-surface coherence without waiting for a long historical soak? — Current thinking: fixture-backed verification plus representative end-to-end surface checks.

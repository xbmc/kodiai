# M052: Large-PR truth baseline

**Vision:** Define and prove a truthful bounded-review contract for large PRs so Kodiai produces useful first-pass review output instead of falling into a dead-end `max_turns` lifecycle.

## Success Criteria

- Large PRs produce a truthful bounded first-pass review contract instead of a dead-end `max_turns` user experience.
- The visible review surface reports coverage and in-progress state coherently without implying exhaustiveness.
- A deterministic proof surface catches regressions in large-PR first-pass truthfulness.

## Key Risks / Unknowns

- The current bounded-review contract may already exist in multiple partially divergent surfaces — M052 has to reconcile those seams before later continuation work can safely build on top of them.
- Coverage/state wording could become noisy or misleading on the visible review surface — the product contract depends on truthful but concise GitHub-visible output, not operator dump text.
- Existing idempotency and publish-rights rules may constrain later in-place lifecycle updates — if the baseline contract ignores those constraints, M053 may have to unwind M052 surfaces.

## Proof Strategy

- Dead-end large-PR failure semantics → retire in S01 by proving a constrained large PR now resolves to a bounded first-pass contract instead of a useless dead-end outcome.
- Visible review surface overclaims coverage → retire in S02 by proving the published review surface states coverage, remaining scope, and pending continuation truthfully and concisely.
- Large-PR baseline drifts without detection → retire in S03 by proving a deterministic verifier catches regressions in the bounded first-pass contract before continuation redesign starts.

## Verification Classes

- Contract verification: unit/integration tests plus a deterministic verifier covering bounded first-pass state, visible coverage rendering, and non-exhaustive truthfulness.
- Integration verification: exercise the large-PR review handler/publication path far enough to prove the bounded first-pass contract and visible review surface agree.
- Operational verification: operator-facing proof surface reports the bounded first-pass baseline truthfully before automatic continuation is added.
- UAT / human verification: inspect one large-PR-style review output and confirm the visible contract reads as useful, quiet, and explicitly non-exhaustive.

## Milestone Definition of Done

This milestone is complete only when all are true:

- Large-PR first-pass behavior is explicitly defined as a bounded-review contract rather than an accidental timeout artifact.
- GitHub-visible review output tells the truth about coverage and in-progress state.
- A deterministic proof surface catches regressions in large-PR first-pass truthfulness.
- The milestone leaves a clean substrate for M053 automatic continuation work rather than a one-off patch.
- Requirement ownership for the redesign track is explicit enough that later milestones do not need to re-litigate the contract.

## Requirement Coverage

- Covers: R061, R064
- Partially covers: R049, R050
- Leaves for later: R062, R063, R065, R066, R067, R068, R069, R070
- Orphan risks: none

## Slices

- [ ] **S01: Bounded first-pass contract** `risk:high` `depends:[]`
  > After this: a large PR that would previously die at `max_turns` produces a truthful bounded first-pass result instead of an empty or dead-end failure outcome.
- [ ] **S02: Coverage and visible-state rendering** `risk:medium` `depends:[S01]`
  > After this: the visible review surface states what was covered, what remains, and whether continuation is still in progress, using one coherent comment contract.
- [ ] **S03: Large-PR baseline proof harness** `risk:medium` `depends:[S01,S02]`
  > After this: operators can run a deterministic verifier that proves the bounded large-PR baseline behaves truthfully before continuation redesign starts.

## Boundary Map

### S01 → S02

Produces:
- bounded first-pass contract for large PR reviews, including the user-visible states that are allowed when review work is constrained
- normalized first-pass state payload fields for covered scope, remaining scope, and bounded-review reason
- deterministic proof inputs showing the old dead-end path versus the new bounded-first-pass contract

Consumes:
- existing large-PR triage, timeout-estimation, and review publication surfaces in `src/handlers/review.ts`

### S02 → S03

Produces:
- one coherent visible-review rendering contract for bounded first-pass output
- coverage/state wording rules for Review Details and any paired visible summary surface
- regression expectations proving the visible surface does not imply exhaustive review

Consumes from S01:
- normalized bounded first-pass contract and state payload

### S01 → S03

Produces:
- machine-checkable large-PR first-pass contract assumptions for verifier inputs

Consumes:
- existing review publication identity (`reviewOutputKey`) and operator evidence surfaces

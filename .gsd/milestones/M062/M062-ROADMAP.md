# M062: Large-PR truth baseline

**Vision:** Define and prove a truthful bounded-review contract for large PRs so Kodiai produces useful first-pass review output instead of falling into a dead-end `max_turns` lifecycle.

## Success Criteria

- Large PRs produce a truthful bounded first-pass review contract instead of a dead-end `max_turns` user experience.
- The visible review surface reports coverage and in-progress state coherently without implying exhaustiveness.
- A deterministic proof surface catches regressions in large-PR first-pass truthfulness.

## Slices

- [x] **S01: S01** `risk:high` `depends:[]`
  > After this: After this: a large PR that would previously die at `max_turns` produces a truthful bounded first-pass result instead of an empty or dead-end failure outcome.

- [x] **S02: S02** `risk:medium` `depends:[]`
  > After this: After this: the visible review surface states what was covered, what remains, and whether continuation is still in progress, using one coherent comment contract.

- [x] **S03: S03** `risk:medium` `depends:[]`
  > After this: After this: operators can run a deterministic verifier that proves the bounded large-PR baseline behaves truthfully before continuation redesign starts.

## Boundary Map

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

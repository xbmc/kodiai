# M062: Large-PR truth baseline

**Gathered:** 2026-04-23
**Status:** Ready for planning

## Project Description

Kodiai needs a large-PR review redesign, not another narrow threshold tweak. The first step is to define and prove a truthful bounded-review contract for large pull requests so the system stops failing as a one-shot review that burns turns and ends with an unhelpful `max_turns` terminal state. This milestone establishes what the first visible review must say, what coverage it must report, and what evidence surface operators can use to prove that the baseline is truthful before automatic continuation is added in later milestones.

## Why This Milestone

The current codebase already has large-PR triage, timeout-risk estimation, dynamic timeout scaling, and bounded-review disclosure, but those pieces still behave like mitigation around a one-shot review path. The user wants a hybrid system: useful bounded first pass quickly, then automatic continuation in the background, with one stable visible review surface that gets updated in place. M062 exists so later execution redesign work starts from an explicit product contract instead of from accidental timeout behavior.

## User-Visible Outcome

### When this milestone is complete, the user can:

- see a truthful bounded first-pass review on a large PR instead of a dead-end `max_turns` outcome with no useful review contract
- read one coherent visible review surface that states what was covered, what remains, and whether deeper review is still in progress

### Entry point / environment

- Entry point: GitHub pull request review flow triggered by Kodiai on real PRs
- Environment: production-like GitHub PR review pipeline plus deterministic verifier/test surfaces
- Live dependencies involved: GitHub review/comment publication, Azure-executed review jobs, review telemetry/evidence surfaces

## Completion Class

- Contract complete means: the bounded first-pass lifecycle is defined and mechanically verifiable
- Integration complete means: the review handler, publication path, and visible review surface all agree on the same bounded-state contract
- Operational complete means: operators have a deterministic proof surface for large-PR first-pass truthfulness before automatic continuation lands

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- a large PR that would previously fall into a dead `max_turns` terminal path now produces a truthful bounded first-pass review contract
- the visible review surface reports coverage and in-progress state coherently instead of implying exhaustiveness
- the deterministic proof surface catches regressions in large-PR first-pass truthfulness and visible-state rendering

## Scope

### In Scope

- redefining large-PR first-pass behavior as an explicit bounded-review contract
- truthful coverage accounting for the first visible review surface
- visible rendering of bounded state, remaining scope, and continuation-in-progress language
- deterministic verifier/proof surfaces for the bounded first-pass baseline

### Out of Scope / Non-Goals

- automatic continuation execution itself
- manual deepening commands as the primary path
- exhaustive eventual coverage guarantees for all changed files
- multi-comment continuation behavior

## Architectural Decisions

### Hybrid review contract

**Decision:** Large PRs use a hybrid contract: bounded first-pass review now, deeper review later.

**Rationale:** The user wants immediate high-signal output without pretending the review is exhaustive, and later milestones will add automatic continuation.

**Evidence source:** user discussion plus existing bounded-review and timeout machinery in `src/handlers/review.ts`.

**Alternatives Considered:**
- Exhaustive single-pass review — not credible on very large PRs.
- Manual deepening only — too easy to neglect and not the desired default.

### One stable visible review surface

**Decision:** The public review surface must evolve in place rather than create new public comments for continuation.

**Rationale:** Quiet UX is a product constraint, not a cosmetic preference.

**Evidence source:** user discussion plus existing `reviewOutputKey` marker identity and append/upsert publication patterns.

**Alternatives Considered:**
- A new public comment per continuation pass — rejected as noisy.
- A separate deep-review sidecar surface — rejected as drifting from the desired contract.

### Truthful sufficiency, not exhaustiveness

**Decision:** Large-PR review is allowed to stop after sufficient high-risk coverage and must disclose that it is sufficient-but-bounded rather than exhaustive.

**Rationale:** This keeps the system practical and aligns the product contract with real runtime limits.

**Evidence source:** user discussion plus existing large-PR triage model.

**Alternatives Considered:**
- Exhaustive eventual coverage as the required stopping condition — rejected by user.

### Explicitly revisable findings

**Decision:** Findings may later be revised, but never silently.

**Rationale:** A bounded first pass may be incomplete; later evidence should be allowed to improve correctness without hiding churn.

**Evidence source:** user discussion.

**Alternatives Considered:**
- Immutable findings once published — simpler, but can freeze shallow first-pass mistakes.

## Error Handling Strategy

First-pass `max_turns` or timeout must not leave the PR with a dead-end user experience. If the review is bounded by system limits, the same visible review surface should still publish the truthful first-pass result and disclose that deeper review is pending. This milestone does not implement continuation yet, but it defines the contract later milestones must honor.

The baseline fail-safe behavior is: keep one visible review surface, disclose bounded coverage honestly, never imply exhaustiveness, and fail safe to an explicit partial state when deeper lifecycle pieces are missing or broken. New commits must supersede stale work later in the redesign, and the current milestone’s verifier surfaces should leave space for that without hardcoding silent failure semantics into the product contract.

## Risks and Unknowns

- The current codebase may already partially encode a bounded-review contract in multiple places — if those surfaces diverge, M062 needs to reconcile them before later milestones build on top.
- Coverage language could become noisy or overly operational if the visible review surface is not kept concise.
- Existing idempotency/publish-rights logic may constrain how the later continuation path can safely update the same surface.

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — current large-PR triage, timeout estimation, bounded-review disclosure, review publication, and Review Details rendering.
- `src/execution/review-prompt.ts` — prompt contract surface that already receives large-PR and boundedness context.
- `src/handlers/review-idempotency.ts` — stable review identity and marker handling via `reviewOutputKey`.
- `src/lib/review-utils.ts` — Review Details formatting and marker helpers.
- `src/jobs/review-work-coordinator.ts` — existing supersession/coordinator patterns relevant to later continuation work.
- `docs/configuration.md` — current documented `largePR` and `timeout` knobs.

## Relevant Requirements

- R061 — truthful bounded first review instead of dead `max_turns` failure
- R064 — visible coverage and in-progress state reporting
- R049 — large-review latency and truthful bounded behavior remain operator-visible
- R050 — durable per-phase/operator evidence remains exposed

## Technical Constraints

- The visible review contract must stay truthful on GitHub and must not create public comment spam.
- This milestone defines the first-pass contract only; it must not fake automatic continuation before that lifecycle exists.
- Proof must be mechanical enough to support downstream milestone planning and regression gates.

## Integration Points

- GitHub PR review/comment surfaces — where bounded first-pass output is published
- Azure Container App job execution — where large-review first-pass runtime still occurs
- review publication/idempotency machinery — the stable identity and update contract
- operator/verifier evidence surfaces — where the baseline truthfulness is proven

## Testing Requirements

This milestone needs unit and integration coverage for bounded-review state shaping, visible coverage rendering, and publication semantics, plus at least one deterministic verifier that proves the large-PR first-pass contract stays truthful. The verifier must assert that the bounded first-pass surface does not imply exhaustive review and does not collapse into a dead-end failure path when the review is constrained.

## Acceptance Criteria

- On a large PR, Kodiai produces a bounded first-pass review contract instead of a dead terminal `max_turns` user experience.
- The visible review surface reports what was covered, what remains, and whether deeper review is still pending.
- The large-PR first-pass contract is expressed consistently across handler logic, visible review output, and deterministic verifier/report surfaces.
- This milestone leaves a clean substrate for automatic continuation work rather than a one-off patch.

## Open Questions

- How compact can the evolving visible review surface stay once continuation and explicit finding revisions arrive?
- Which existing publication path should become the single source of truth for later in-place continuation updates?

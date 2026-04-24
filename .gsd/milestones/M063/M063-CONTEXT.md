---
depends_on: [M062]
---

# M063: Continuation-driven review execution

**Gathered:** 2026-04-23
**Status:** Ready for planning

## Project Description

M063 turns large-PR continuation into a first-class review lifecycle. The product contract stays the same as discussed: large PRs should ideally complete in a single bounded first pass, but when that is not enough, Kodiai should continue automatically in the background while preserving one stable public review surface. Internally this is modeled as discrete continuation passes, but externally it should still feel like the same review getting deeper rather than a second review appearing on the PR.

## Why This Milestone

The current codebase already has timeout retry logic, checkpoints, comment updates, review identity markers, and same-PR supersession coordination. Those pieces are not yet the desired product behavior: they are still mainly error recovery around a one-shot review path. M063 exists to turn those seams into the actual execution contract for large PR continuation, with token discipline built in so continuation does not become an expensive replay of the first pass.

## User-Visible Outcome

### When this milestone is complete, the user can:

- receive a bounded large-PR review that automatically deepens in the background when needed without asking for a follow-up command
- keep reading the same review voice and same visible review surface as coverage deepens, findings are revised explicitly, and the lifecycle settles

### Entry point / environment

- Entry point: GitHub PR review flow for large PRs that need follow-up after the bounded first pass
- Environment: production-like PR review handler/executor/publication path with deterministic continuation proof coverage
- Live dependencies involved: GitHub review/comment publication, Azure review execution jobs, continuation state/checkpoint storage, publish-rights coordination

## Completion Class

- Contract complete means: automatic continuation exists as a first-class lifecycle for large PRs
- Integration complete means: first pass, continuation passes, same-comment publication, and supersession all behave as one coherent review lifecycle
- Operational complete means: continuation behavior is bounded, attributable, and measurably narrower than the first pass

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- a bounded large-PR first pass can trigger automatic continuation without manual intervention
- continuation updates the same visible review surface instead of creating a second public comment
- continuation prompt/context is measurably narrower than the first pass and bounded by design
- superseded continuation cannot overwrite the authoritative review state for a newer commit

## Scope

### In Scope

- automatic continuation as the default follow-up path for large-PR bounded reviews
- internal execution modeled as discrete continuation passes with one stable public review surface
- same-review voice preservation across continuation updates
- explicit revision semantics for previously published findings
- token-disciplined continuation prompt/context shaping
- bounded continuation attempt behavior and authoritative supersession rules

### Out of Scope / Non-Goals

- turning continuation into the general execution model for all review types
- making continuation a visibly different operational dashboard experience
- assuming most PRs should routinely require continuation
- repo-level operator config tuning for continuation aggressiveness

## Architectural Decisions

### Discrete internal passes, one public review

**Decision:** Model continuation as discrete internal passes while preserving one stable public review surface.

**Rationale:** Discrete passes are easier to reason about for retries, supersession, and lifecycle attribution than pretending one long-running review survives transparently across interruption boundaries.

**Evidence source:** codebase review of `src/handlers/review.ts`, `src/jobs/review-work-coordinator.ts`, and `src/handlers/review-idempotency.ts`.

**Alternatives Considered:**
- True single logical resume — cheaper in theory, but fragile unless state rehydration is nearly perfect.
- Separate public follow-up reviews — rejected because the product contract is one evolving review surface.

### Large-PR-first scope

**Decision:** Continuation in M063 is a large-PR-first feature, though the internals should be reusable later.

**Rationale:** The user wants this solved for large PRs without turning the milestone into a broad rewrite of every review path.

**Evidence source:** user discussion.

**Alternatives Considered:**
- Universal continuation for all review modes in this milestone — broader than the immediate product need.

### Preserve review voice

**Decision:** Continuation updates preserve the original review voice and structure rather than switching to an operational status tone.

**Rationale:** Continuation is fallback behavior, not the primary UX. The review should still feel like one review getting deeper.

**Evidence source:** user discussion.

**Alternatives Considered:**
- A status-heavy continuation presentation — rejected because it would make continuation feel like a different product mode.

### Token-disciplined continuation

**Decision:** Continuation passes must be narrower than the first pass and must reuse persisted state rather than replay full first-pass context.

**Rationale:** Discrete passes are only acceptable if they do not recreate the first-pass token cost as the new normal failure mode.

**Evidence source:** user concern about token usage plus current token-efficiency direction in the codebase.

**Alternatives Considered:**
- Add continuation first and optimize later — rejected because token cost is part of the architecture contract here.

## Error Handling Strategy

Continuation should preserve the current public review as the source of truth and only deepen it when a continuation pass has meaningful new value. If a continuation pass fails before producing new value, the public review should remain intact and the lifecycle should either retry within a bounded attempt budget or settle as incomplete. If a newer commit arrives, stale continuation loses authority immediately and must not overwrite the current review state.

If continuation revises an earlier finding, that revision must be explicit on the same review surface rather than a silent rewrite. If continuation has no meaningful delta, it should not churn the public review just to announce internal work. If prompt/context would grow too large, the system should shrink continuation scope instead of replaying a near-full first pass.

## Risks and Unknowns

- Continuation could accidentally rehydrate too much context and become nearly as expensive as the first pass.
- The public review could drift toward an operational lifecycle log instead of one coherent review.
- Supersession rules may be easy to get subtly wrong if the current coordinator semantics are not reused carefully.
- If continuation becomes common instead of exceptional, the UX contract is already failing.

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — current timeout retry path, checkpoint handling, review publication, partial review merge, and same-comment update seams.
- `src/jobs/review-work-coordinator.ts` — same-PR attempt coordination and publish-rights authority.
- `src/handlers/review-idempotency.ts` — stable review identity and marker parsing for review surfaces.
- `src/lib/review-utils.ts` — current Review Details formatting and marker helpers.
- `src/execution/review-prompt.ts` — review prompt contract that will need token-disciplined continuation shaping.

## Relevant Requirements

- R062 — automatic continuation without manual follow-up
- R063 — same visible review surface, no extra public comment
- R065 — explicit revision of findings
- R066 — continuation remains sufficient-but-bounded rather than exhaustive

## Technical Constraints

- Continuation must remain narrower than the first pass in both scope and prompt/context assembly.
- The public review surface must remain a single evolving review, not a lifecycle thread.
- Large-PR-first scope must not accidentally redesign every review path in this milestone.
- The milestone must preserve room for M064 supersession/evidence hardening and M065 live rollout proof.

## Integration Points

- review handler execution path in `src/handlers/review.ts`
- continuation/retry coordination via `src/jobs/review-work-coordinator.ts`
- review identity and comment update path via `reviewOutputKey`
- checkpoint/state persistence and merged partial review update path
- GitHub publication/update semantics on the existing visible review surface

## Testing Requirements

This milestone needs unit coverage for continuation planning, pass-budget enforcement, finding revision semantics, and authoritative supersession rules; integration coverage for first pass → automatic continuation → same-comment update; and deterministic token-budget proof that continuation prompt assembly is narrower than the first pass. The milestone also needs at least one end-to-end continuation lifecycle proof through the real handler/publication path, even if it remains in controlled test conditions.

## Acceptance Criteria

- A bounded large-PR first pass can trigger automatic continuation without manual intervention.
- Continuation updates the same visible review surface instead of creating a second public comment.
- Continuation prompt/context is measurably narrower than the first pass.
- Superseded continuation cannot overwrite authoritative state for a newer commit.
- Explicit finding revision works on the same public review surface.

## Open Questions

- What exact visible wording should mark a settled continuation that added no meaningful new user-visible value?
- Which current retry/partial-review mechanics can be promoted directly into continuation behavior, and which should be replaced rather than generalized?

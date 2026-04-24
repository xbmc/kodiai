---
depends_on: [M064]
---

# M065: Live hardening and rollout proof

**Gathered:** 2026-04-23
**Status:** Ready for planning

## Project Description

M065 is the rollout and closeout milestone for the large-PR redesign track. It does not redefine the product contract again; instead it proves that the redesigned lifecycle holds together in reality. The milestone composes the earlier proof surfaces — bounded first-pass truth, continuation execution, and canonical lifecycle state — with one minimum credible live proof on a safe but representative large PR path.

## Why This Milestone

The redesign changes the user-visible review contract and the operator-facing lifecycle model. That is too important to close on deterministic tests alone. This repo already favors command-shaped, machine-readable verifiers paired with runbooks and nested evidence. M065 exists to package the large-PR redesign into that same operational form: one top-level verifier, one minimum credible live proof, and one repeatable operator drill-down path.

## User-Visible Outcome

### When this milestone is complete, the user can:

- trust that the redesigned large-PR lifecycle has been proven on a real PR path rather than only in controlled tests
- benefit from the large-PR redesign without small/normal PR review behavior regressing silently

### Entry point / environment

- Entry point: top-level verifier command, supporting runbook/operator flow, and one live large-PR proof path
- Environment: safe but representative proving repo/path with real GitHub review publication and continuation lifecycle behavior
- Live dependencies involved: GitHub review publication, review execution infrastructure, lifecycle/operator evidence surfaces, verifier/runbook tooling

## Completion Class

- Contract complete means: the redesign track has one composed closeout verifier preserving earlier milestone proof surfaces
- Integration complete means: contract, execution, lifecycle state, and live proof all agree on the same redesign outcome
- Operational complete means: operators can rerun the proof, inspect nested failures, and trust that large-PR improvements did not regress ordinary review behavior

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- one top-level verifier composes the redesign track and preserves nested evidence from M062, M063, and M064
- one safe but representative live large-PR proof demonstrates the actual lifecycle contract in reality
- ordinary/small PR review behavior did not regress while the large-PR lifecycle improved

## Scope

### In Scope

- one composed top-level verifier for the redesign track
- one minimum credible live proof on a safe but representative large PR path
- runbook/operator rerun and drill-down guidance for the redesign proof
- explicit regression proof that normal/small PR behavior did not get worse

### Out of Scope / Non-Goals

- multi-run soak campaigns as a milestone requirement
- calling the redesign done on deterministic tests alone
- inventing a new closure ritual instead of reusing the repo’s verifier/runbook pattern

## Architectural Decisions

### Composed top-level verifier

**Decision:** Rollout proof centers on one top-level verifier that composes earlier milestone contracts plus the live proof result.

**Rationale:** The redesign spans first-pass contract, continuation execution, lifecycle authority, and live proof. Operators need one place to ask whether the whole system is still holding together.

**Evidence source:** user agreement plus existing repo pattern for milestone-close verification.

**Alternatives Considered:**
- Live-only verifier with manual drill-down — simpler, but makes failure localization slower and easier to hand-wave.

### Minimum live proof, but representative

**Decision:** Require one minimum credible live proof on the safest path that still exercises the real large-PR lifecycle.

**Rationale:** The milestone should prove reality without turning into a prolonged soak campaign or accepting a toy PR that never really tests continuation behavior.

**Evidence source:** user discussion.

**Alternatives Considered:**
- Multiple live proofs as a release requirement — too heavy for this milestone.
- Safe but unrepresentative proof — not strong enough.

### Preserve nested evidence

**Decision:** The top-level verifier should preserve nested evidence from M062/M063/M064 rather than rebuilding those contracts from scratch.

**Rationale:** Earlier milestone verifiers should remain authoritative, and closeout should help localize failure rather than duplicate logic.

**Evidence source:** current repo verifier patterns.

**Alternatives Considered:**
- Duplicate earlier milestone logic in the rollout verifier — drift-prone and harder to trust.

### Small-PR regression remains in scope

**Decision:** M065 explicitly checks that normal/small PR review behavior did not regress while the large-PR lifecycle improved.

**Rationale:** Rollout proof is incomplete if the redesign only succeeds by making ordinary review behavior worse.

**Evidence source:** requirement R069 and user quality-bar agreement.

**Alternatives Considered:**
- Defer regression proof — too risky for the rollout milestone.

## Error Handling Strategy

If the live proof is unavailable, the milestone must not claim full success on composed historical evidence alone. If the chosen PR/path is safe but not representative enough to exercise continuation, that is insufficient proof rather than a green result. If the live proof shows lifecycle drift — for example, broken same-surface update semantics, authority mismatch, or missing nested evidence alignment — the top-level verifier should fail with the exact failing sub-contract still visible.

Nested evidence must remain distinct proof obligations. Missing or failing prior proof cannot be flattened into a green closeout. Likewise, a successful large-PR proof does not waive regression on normal/small PR behavior.

## Risks and Unknowns

- The proving PR/path could be safe but not representative enough to really exercise the redesigned lifecycle.
- The composed verifier could flatten earlier milestone evidence too aggressively and make failures harder to localize.
- A compelling large-PR proof could tempt operators to overlook ordinary-review regressions if that guard is not made explicit.

## Existing Codebase / Prior Art

- `scripts/verify-m048-s01.ts`, `scripts/verify-m048-s02.ts`, `scripts/verify-m048-s03.ts` — composed and nested verifier pattern for review proof surfaces.
- `docs/runbooks/review-requested-debug.md` — operator runbook style for review-path investigation.
- `docs/runbooks/recent-review-audit.md` — operator-facing audit/verifier packaging pattern.
- existing milestone verifier families under `scripts/verify-m0**` — stable command + report + nested evidence style.

## Relevant Requirements

- R069 — preserve small/normal PR behavior without regression
- R070 — prove the redesigned large-PR lifecycle on at least one real large PR with in-place visible review evolution
- R061–R068 — inherited redesign contracts that M065 closes out rather than introduces

## Technical Constraints

- One credible live proof is required; deterministic evidence alone is insufficient.
- The live proof must be safe enough operationally but still representative enough to test the lifecycle.
- The top-level verifier must preserve nested evidence instead of flattening earlier milestone contracts into prose.
- The milestone must not redefine the public review contract again.

## Integration Points

- prior milestone verifiers and proof surfaces from M062–M064
- live GitHub review publication/update path on the chosen proving PR
- operator rerun/runbook surfaces used to inspect and explain rollout state
- regression gates for non-large PR review behavior

## Testing Requirements

This milestone needs a top-level composed verifier with stable check IDs and nested evidence, one live proof path that exercises the actual large-PR lifecycle on a safe but representative PR, and targeted regression checks proving that ordinary review behavior did not get worse. The runbook/operator flow must show how to rerun the verifier and drill into the live proof if it fails.

## Acceptance Criteria

- One top-level verifier composes M062, M063, M064, and the live proof result.
- One minimum credible live proof passes on a safe but representative large PR path.
- Nested evidence remains preserved and attributable.
- Small/normal PR behavior is checked explicitly for regression.

## Open Questions

- Which concrete proving repo and PR shape should be chosen as the minimum live proof target?
- Which existing verifier family should M065 extend versus wrap so the final closeout surface stays concise without hiding nested evidence?

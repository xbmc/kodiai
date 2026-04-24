# M065: Live hardening and rollout proof

**Vision:** Close the large-PR redesign track with one operator-usable rollout proof surface: a composed top-level verifier that preserves M062-M064 authority, one minimum credible live large-PR proof on a safe representative path, and fresh explicit regression evidence that ordinary review behavior did not get worse.

## Success Criteria

- One top-level verifier composes M062, M063, M064, and the live-proof/regression result without flattening nested authority.
- One safe but representative live large-PR proof demonstrates the redesigned lifecycle on a real path rather than only in deterministic fixtures.
- Fresh explicit non-large regression evidence is included in M065 closeout so ordinary review behavior is not inferred from stale historical validation.
- Operators can rerun the milestone proof from stable identifiers (`reviewOutputKey`, delivery identity) and drill into failing sub-contracts mechanically.

## Slices

- [ ] **S01: S01** `risk:High — if the top-level verifier flattens prior milestone evidence or invents new authority, M065 can go green while hiding the actual failing sub-contract.` `depends:[]`
  > After this: `bun run verify:m065 -- --json` returns one milestone-level verdict while preserving attributable nested evidence from M062, M063, and M064, with stable check IDs and drill-down pointers instead of a flattened summary.

- [ ] **S02: Representative live large-PR proof** `risk:High — a weak or unrepresentative live run could claim rollout success without actually exercising bounded first pass, continuation, same-surface evolution, and canonical lifecycle agreement.` `depends:[S01]`
  > After this: Operators can run the M065 live-proof path against one safe representative large PR and see a passing/failing machine-readable result anchored on the captured base `reviewOutputKey`, delivery identity, visible review evidence, and canonical continuation-family operator evidence.

- [ ] **S03: Fresh regression guard and operator rerun packaging** `risk:Medium — rollout proof is incomplete if non-large review behavior is inferred from stale historical evidence or if operators cannot rerun and localize a failing live proof quickly.` `depends:[S01,S02]`
  > After this: The final M065 surface fails when fresh non-large regression evidence is missing or red, and the runbook shows an operator how to rerun `verify:m065`, start from `reviewOutputKey`/delivery IDs, and drill into the failing nested contract without log archaeology.

## Boundary Map

### Boundary map
- **S01 owns** the milestone-level verifier contract and report shape. It may wrap existing verifier families and add report composition helpers, but it must not move rollout-specific branching into `src/handlers/review.ts` or duplicate M062-M064 logic.
- **S02 owns** the real live-proof evidence contract and verification flow. It may add verifier/reporting helpers plus captured-identity plumbing around existing operator evidence seams, but it does not redesign review runtime semantics or publication identity.
- **S03 owns** fresh non-large regression proof and the operator rerun/drill-down packaging. It may reuse existing regression gates and runbook conventions, but it does not create new lifecycle truth sources or substitute prose for machine-checkable evidence.

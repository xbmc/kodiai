# M064: Continuation state, supersession, and operator evidence

**Vision:** Establish one durable canonical continuation-family truth model so operators can answer final authoritative outcome, stop reason, and winning attempt identity directly, while checkpoint, telemetry, and reporting surfaces become projections instead of rival sources of truth.

## Success Criteria

- Canonical continuation-family state persists durably and directly answers final authoritative outcome, stop reason, and authoritative attempt identity.
- Superseded or late-finishing attempts cannot overwrite or ambiguate canonical lifecycle truth or the shipped same-surface publication contract.
- Checkpoint, telemetry, and reporting surfaces project from canonical state and degrade with explicit projection status instead of becoming rival truth sources.
- Operator proof surfaces can recover continuation truth deterministically without correlating scattered logs or ephemeral coordinator memory.

## Slices

- [x] **S01: S01** `risk:high` `depends:[]`
  > After this: After this slice, a deterministic canonical-state query/verifier can show the authoritative continuation family record for merge, quiet-settlement, blocked, and superseded scenarios directly from durable state, including the winning attempt and final stop reason.

- [x] **S02: S02** `risk:high` `depends:[]`
  > After this: After this slice, running the real continuation path through timeout, retry, quiet settlement, and supersession scenarios updates one canonical lifecycle record while stale attempts are unable to overwrite authority or falsely report checkpoint durability.

- [x] **S03: S03** `risk:medium` `depends:[]`
  > After this: After this slice, an operator can run one deterministic report/verifier and see final authoritative outcome, stop reason, winning attempt, and any degraded projection statuses for a continuation family without log correlation.

## Boundary Map

## Boundary map

- **Canonical authority layer**: new durable continuation-family lifecycle model/store keyed by stable review family identity and base `reviewOutputKey`; owns authoritative outcome, stop reason, attempt authority, and projection-status truth.
- **Runtime coordination layer**: `ReviewWorkCoordinator` remains the in-process publish gate but projects authority transitions into canonical state instead of being the only place authority exists.
- **Scratch progress layer**: `review_checkpoints` continues to represent partial work and merge inputs only; it is no longer the place operators infer family truth.
- **Projection layer**: resilience telemetry, checkpoint linkage, and operator report/verifier outputs become projections of canonical state and may report incomplete/degraded status without redefining authority.
- **Public review surface**: same bounded first-pass comment and in-place continuation updates from M063 remain unchanged; M064 hardens the internal truth behind them rather than expanding public UX.

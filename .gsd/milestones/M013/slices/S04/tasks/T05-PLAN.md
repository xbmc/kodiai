# T05: 75-live-ops-verification-closure 05

**Slice:** S04 — **Milestone:** M013

## Description

Close the identity-capture gaps that are blocking OPS75 by collecting one fresh, preflight-valid matrix for review and mention cache lanes plus degraded executions that truly emitted degraded telemetry rows.

Purpose: Current reruns fail because identities are selected from incomplete telemetry snapshots; this plan makes identity gating and evidence capture deterministic before any closure claim.
Output: Updated runbook and smoke evidence containing a validated same-run identity matrix ready for a release-blocking verifier run.

## Must-Haves

- [ ] "Deterministic closure evidence includes accepted review_requested and explicit @kodiai mention lanes for the same OPS75 matrix run"
- [ ] "Live OPS75 evidence proves exactly one degraded telemetry row per degraded execution identity with duplicate checks passing"

## Files

- `docs/runbooks/review-requested-debug.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`

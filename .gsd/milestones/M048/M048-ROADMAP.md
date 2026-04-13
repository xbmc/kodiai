# M048: PR Review Latency Reduction and Bounded Execution

## Vision
Make the real xbmc/kodiai PR review path measurably faster without lying about coverage: expose durable phase timing on live reviews, remove avoidable single-worker overhead, and make bounded large-PR behavior plus synchronize-trigger continuity explicit and operator-verifiable.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | S01 | high — without durable phase attribution on the real review path, later optimization work can target the wrong bottleneck and fail m048 proof. | — | ✅ | Trigger a real xbmc/kodiai review and inspect Review Details plus the live verifier/audit output to see queue wait, workspace preparation, retrieval/context assembly, executor handoff/runtime, and publication timings tied to the review output key. |
| S02 | S02 | high — fixed workspace, bundle, and aca polling overhead may dominate every review, so the existing one-worker path must get faster before fan-out is considered. | — | ✅ | Run the same live review path and see materially lower workspace, handoff, or polling overhead in the phase timing surfaces while GitHub publication and idempotency still behave normally. |
| S03 | S03 | medium-high — large/manual-strict reviews currently block the main timeout safeguard, and mis-shaped synchronize triggers slow live proof loops while hiding configuration drift. | — | ⬜ | Push new commits to an xbmc/kodiai PR and see synchronize-triggered reviews fire when configured; on high-risk strict reviews, the GitHub-visible outcome and Review Details clearly disclose any bounded or reduced-scope behavior instead of implying exhaustive coverage. |

# M036: Auto Rule Generation from Feedback

## Vision
Turn positive review feedback into durable active rules that shape future reviews through a bounded, sanitized, observable lifecycle.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Generated Rule Schema, Store, and Proposal Candidates | medium | — | ✅ | After this slice, Kodiai can persist generated rules and produce bounded pending-rule candidates from clustered learning memories. |
| S02 | Rule Activation and Prompt Injection | high | S01 | ✅ | After this slice, high-confidence proposals can auto-activate and appear as sanitized active rules in the review prompt. |
| S03 | Retirement, Notification, and Lifecycle Proof | medium | S01, S02 | ⬜ | After this slice, generated rules can retire when their signal decays, operators can see activation/retirement events, and the verifier proves the lifecycle end to end. |

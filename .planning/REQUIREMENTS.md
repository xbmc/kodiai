# Requirements: Kodiai

**Defined:** 2026-02-18
**Core Value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.14 Requirements

Requirements for the Slack Integration milestone.

### Slack Ingress & Safety

- [ ] **SLK-01**: Kodiai validates Slack request signatures/timestamps before processing events.
- [ ] **SLK-02**: Slack v1 is low-noise: only `#kodiai`, no DMs, thread-only replies, and mention-only thread bootstrap.

### Thread Session UX

- [ ] **SLK-03**: Once a thread is started with `@kodiai`, in-thread follow-up messages are handled without needing repeated mentions.

### Assistant Behavior

- [ ] **SLK-04**: Slack assistant remains read-only (no code modifications, no branch/PR creation, no CI/build execution).
- [ ] **SLK-05**: Default repo context is `xbmc/xbmc`, with explicit override acknowledgement and one-question ambiguity handling.

### Operator Reliability

- [ ] **SLK-06**: Operators can run deterministic smoke/regression checks proving Slack channel/thread gating and session behavior remain intact.

## Future Requirements

Deferred to a later milestone.

- **SLK-07**: Multi-workspace Slack support.
- **SLK-08**: Slack interactive controls (buttons/modals) for guided clarification.
- **SLK-09**: Optional Slack -> GitHub publishing workflow for approved summaries.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Slack DM support | v1 is intentionally channel-scoped to reduce noise and ambiguity |
| Multi-channel rollout | Start with one explicit operating lane (`#kodiai`) |
| Slack write-mode (PR creation from Slack) | Keep Slack v1 read-only for safety |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SLK-01 | Phase 77 | Pending |
| SLK-02 | Phase 77 | Pending |
| SLK-03 | Phase 78 | Pending |
| SLK-04 | Phase 79 | Pending |
| SLK-05 | Phase 79 | Pending |
| SLK-06 | Phase 80 | Pending |

**Coverage:**
- v0.14 requirements: 6 total
- Mapped to phases: 6
- Unmapped: 0

---
*Requirements defined: 2026-02-18*

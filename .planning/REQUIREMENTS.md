# Requirements: Kodiai

**Defined:** 2026-02-19
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.16 Requirements

Requirements for v0.16 Review Coverage & Slack UX.

### Review Coverage

- [x] **REV-01**: Kodiai reviews draft PRs the same as non-draft PRs (no skip)
- [x] **REV-02**: Draft PR reviews include a visual indicator that the PR is a draft (so the review acknowledges draft status)

### Slack UX

- [x] **SLK-07**: Slack responses omit preamble phrases ("Here's a summary", "Here's what I found")
- [x] **SLK-08**: Slack responses omit Sources/References sections
- [x] **SLK-09**: Slack responses are concise (1-3 sentences for simple questions, proportional for complex ones)
- [x] **SLK-10**: Slack responses use conversational tone (no headers/bullet structure for simple answers)

## Future Requirements

None deferred.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Draft PR config toggle | User chose always-review; no opt-out needed for now |
| Slack interactive controls (buttons/modals) | Text-based for v1 |
| Multi-workspace Slack | Single workspace for now |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REV-01 | Phase 82 | Complete |
| REV-02 | Phase 82 | Complete |
| SLK-07 | Phase 83 | Complete |
| SLK-08 | Phase 83 | Complete |
| SLK-09 | Phase 83 | Complete |
| SLK-10 | Phase 83 | Complete |

**Coverage:**
- v0.16 requirements: 6 total
- Mapped to phases: 6
- Unmapped: 0

---
*Requirements defined: 2026-02-19*
*Last updated: 2026-02-19 after roadmap creation*

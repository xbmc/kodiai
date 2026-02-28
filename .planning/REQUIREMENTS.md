# Requirements: Kodiai

**Defined:** 2026-02-27
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.23 Requirements

Requirements for v0.23 Interactive Troubleshooting. Each maps to roadmap phases.

### Troubleshooting Retrieval

- [ ] **TSHOOT-01**: When triggered on an open issue, the system retrieves similar resolved (closed) issues from the corpus using state-filtered vector search
- [ ] **TSHOOT-02**: Comment threads from resolved issues are assembled with resolution-focused priority (tail comments + semantically similar comments), respecting a per-issue character budget
- [ ] **TSHOOT-03**: If no sufficiently similar resolved issues exist, the system falls back to wiki search and then to a transparent "no match" response

### Troubleshooting Agent

- [ ] **TSHOOT-04**: When `@kodiai` is mentioned on an open issue with troubleshooting intent, the system synthesizes targeted guidance grounded in similar resolved issues
- [ ] **TSHOOT-05**: Troubleshooting responses cite the source resolved issues (issue number, title, match score) with provenance disclosure
- [ ] **TSHOOT-06**: Troubleshooting intent is classified via lightweight keyword heuristics on the mention text + issue title/body (no LLM classification call)
- [ ] **TSHOOT-07**: Troubleshooting is gated behind `triage.troubleshooting.enabled` config flag (default: false)
- [ ] **TSHOOT-08**: Troubleshooting comments use comment-scoped marker dedup keyed by trigger comment ID (re-triggerable per mention, not per issue)

### Outcome Capture

- [x] **OUTCOME-01**: `issues.closed` webhook events are captured with resolution outcome (`state_reason`: completed, not_planned, duplicate, unknown)
- [x] **OUTCOME-02**: Confirmed duplicate status is determined from `state_reason` or `duplicate` label (not Kodiai's `possible-duplicate` label)
- [x] **OUTCOME-03**: Outcome records link back to the original triage record in `issue_triage_state` when one exists
- [x] **OUTCOME-04**: The `issues.closed` handler filters out pull requests (GitHub fires this event for PRs too)
- [x] **OUTCOME-05**: Outcome capture is idempotent via delivery-ID dedup on the outcome table

### Threshold Learning

- [ ] **LEARN-01**: Duplicate detection threshold is auto-tuned per repo using Beta-Binomial Bayesian updating from confirmed outcomes
- [ ] **LEARN-02**: Auto-tuned threshold is not applied until at least 20 outcomes have been recorded (minimum sample gate)
- [ ] **LEARN-03**: Auto-tuned threshold is clamped to [50, 95] range to prevent extreme values
- [ ] **LEARN-04**: The duplicate detector reads the effective threshold: auto-tuned if available and sample size is sufficient, otherwise falls back to config value

### Reaction Tracking

- [ ] **REACT-01**: Triage comment GitHub ID is captured and stored when the triage comment is posted
- [ ] **REACT-02**: A periodic sync job polls thumbs up/down reactions on recent triage comments
- [ ] **REACT-03**: Reaction data feeds into the outcome feedback record as a secondary signal

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Classification

- **CLASS-01**: Automatic area classification labels based on issue content
- **CLASS-02**: Per-repo label taxonomy configuration in `.kodiai.yml`

### Assignment

- **ASSIGN-01**: Suggested assignee based on contributor profiles and area labels

### Advanced Threshold

- **THRESH-01**: Per-component threshold tuning (requires 20+ outcomes per component)
- **THRESH-02**: Admin API endpoint for threshold state inspection

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| LLM-based issue classification for component detection | Label-based is sufficient for MVP; LLM classification is expensive per-issue |
| Per-component threshold tuning | Requires 20+ samples per component; global per-repo tuning first |
| Real-time reaction tracking via webhooks | Nightly polling is simpler and sufficient |
| Auto-close duplicate issues | False-positive closures destroy trust; comment + label only |
| Troubleshooting on closed issues | Only open issues need troubleshooting guidance |
| Path-based component detection from linked PRs | Complex API chain; defer until label-based proves insufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TSHOOT-01 | Phase 110 | Pending |
| TSHOOT-02 | Phase 110 | Pending |
| TSHOOT-03 | Phase 110 | Pending |
| TSHOOT-04 | Phase 111 | Pending |
| TSHOOT-05 | Phase 111 | Pending |
| TSHOOT-06 | Phase 111 | Pending |
| TSHOOT-07 | Phase 111 | Pending |
| TSHOOT-08 | Phase 111 | Pending |
| OUTCOME-01 | Phase 112 | Complete |
| OUTCOME-02 | Phase 112 | Complete |
| OUTCOME-03 | Phase 112 | Complete |
| OUTCOME-04 | Phase 112 | Complete |
| OUTCOME-05 | Phase 112 | Complete |
| LEARN-01 | Phase 113 | Pending |
| LEARN-02 | Phase 113 | Pending |
| LEARN-03 | Phase 113 | Pending |
| LEARN-04 | Phase 113 | Pending |
| REACT-01 | Phase 112 | Pending |
| REACT-02 | Phase 114 | Pending |
| REACT-03 | Phase 114 | Pending |

**Coverage:**
- v0.23 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-02-27*

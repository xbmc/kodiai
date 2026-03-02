# Requirements: Kodiai

**Defined:** 2026-03-02
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.24 Requirements

Requirements for Hallucination Prevention & Fact Verification milestone. Each maps to roadmap phases.

### Prompt Guardrails

- [ ] **PROMPT-01**: Review prompt distinguishes diff-visible facts from external knowledge claims with explicit epistemic boundaries
- [ ] **PROMPT-02**: LLM is instructed to never assert specific version numbers, API release dates, or library behavior unless visible in the PR diff
- [ ] **PROMPT-03**: Findings about external dependencies must reference only what the diff shows (e.g., "this code uses X" not "X was introduced in version Y")
- [ ] **PROMPT-04**: Epistemic guardrails apply across all surfaces (PR reviews, @mention responses, Slack answers)

### Claim Classification

- [ ] **CLAIM-01**: Post-LLM pass classifies each finding's claims as diff-grounded vs external-knowledge
- [ ] **CLAIM-02**: Claims referencing specific version numbers, release dates, or API behavior not visible in the diff are flagged as external-knowledge
- [ ] **CLAIM-03**: Classification results are attached to findings for downstream processing (severity demotion, filtering)

### Severity Demotion

- [ ] **SEV-01**: Findings whose core claim depends on unverified external knowledge get severity capped (CRITICAL -> medium max)
- [ ] **SEV-02**: CRITICAL suppression protection (`isFeedbackSuppressionProtected`) does not protect findings with unverified external claims
- [ ] **SEV-03**: Severity demotion is logged for observability (finding title, original severity, new severity, reason)

### Output Filtering

- [ ] **FILT-01**: Findings with a valid diff-grounded core are rewritten to remove external knowledge claims before publishing
- [ ] **FILT-02**: Findings whose entire substance depends on external knowledge are suppressed entirely
- [ ] **FILT-03**: Suppressed/rewritten findings are logged for observability and feedback learning

## Future Requirements

### Retrieval-Augmented Verification

- **RAV-01**: Cross-reference external claims against wiki corpus and known documentation
- **RAV-02**: Use retrieval results to verify or refute version/API claims before publishing

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time external API verification (e.g., hitting PyPI/npm for version info) | Network calls add latency and failure modes; epistemic guardrails are more robust |
| Training data freshness tracking | Not actionable — model knowledge cutoff is fixed per deployment |
| User-configurable hallucination sensitivity | Keep simple for v0.24; single policy that works for all repos |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROMPT-01 | Pending | Pending |
| PROMPT-02 | Pending | Pending |
| PROMPT-03 | Pending | Pending |
| PROMPT-04 | Pending | Pending |
| CLAIM-01 | Pending | Pending |
| CLAIM-02 | Pending | Pending |
| CLAIM-03 | Pending | Pending |
| SEV-01 | Pending | Pending |
| SEV-02 | Pending | Pending |
| SEV-03 | Pending | Pending |
| FILT-01 | Pending | Pending |
| FILT-02 | Pending | Pending |
| FILT-03 | Pending | Pending |

**Coverage:**
- v0.24 requirements: 13 total
- Mapped to phases: 0
- Unmapped: 13

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after initial definition*

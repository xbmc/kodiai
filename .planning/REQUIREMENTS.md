# Requirements: Kodiai

**Defined:** 2026-02-13
**Core Value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, or contextual answers to questions — without requiring any workflow setup in the target repo.

## v0.5 Requirements

Requirements for advanced learning and language support. Each maps to roadmap phases.

### Learning Memory

- [ ] **LEARN-06**: System stores embedding vectors and metadata for accepted/suppressed findings in a repo-scoped knowledge index.
- [ ] **LEARN-07**: Review pipeline retrieves semantically similar prior findings with bounded top-K and score thresholds for prompt context.
- [ ] **LEARN-09**: Review output includes explainable learning provenance (why a retrieved memory influenced the suggestion).

### Incremental Re-review

- [ ] **REV-01**: System re-reviews only changed hunks since the last reviewed base/head SHA pair.
- [ ] **REV-02**: System suppresses duplicate comments for unchanged code and preserves unresolved prior findings context.
- [ ] **REV-03**: Review summary includes delta status (`new`, `resolved`, `still-open`) for incremental runs.

### Multi-Language Review

- [ ] **CTX-05**: Diff analyzer classifies files with language-aware rules beyond TypeScript and exposes per-language context.
- [ ] **CTX-06**: Review prompt injects language-specific guidance while preserving canonical severity/category taxonomy.
- [ ] **LANG-01**: User can set `review.outputLanguage` and receive localized prose without modifying code identifiers/snippets.

### Reliability and Governance

- [ ] **REL-01**: Review state is keyed by immutable SHAs and delivery IDs to keep incremental runs idempotent and stale-run safe.
- [ ] **REL-02**: Retrieval and localization failures degrade gracefully (fail-open) without blocking review publication.
- [ ] **REL-03**: Repo isolation is enforced for learning retrieval by default, with explicit opt-in required for any cross-repo/global sharing.

## v0.6 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Learning Expansion

- **LEARN-10**: Regression detector flags reintroduced previously resolved issues across PRs.
- **LEARN-11**: Org-level shared learning pools with tenancy boundaries and policy controls.

### Platform Expansion

- **LANG-02**: Language-quality tiers auto-tune based on repository acceptance/dismissal outcomes.
- **REV-04**: Incremental re-review supports organization-wide policy baselines and centralized rule packs.

## Out of Scope

Explicitly excluded from v0.5. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Automatic merge blocking from learned confidence alone | High trust risk; keep advisory-first behavior in v0.5. |
| External vector database service | Adds operational complexity before proving value of in-process retrieval. |
| Full multilingual code translation or refactoring | Not aligned with review assistant scope; risk of unsafe transformations. |
| Organization-wide global learning enabled by default | Privacy and tenancy risk; require explicit opt-in governance. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LEARN-06 | Phase 30 | Pending |
| LEARN-07 | Phase 31 | Pending |
| LEARN-09 | Phase 33 | Pending |
| REV-01 | Phase 31 | Pending |
| REV-02 | Phase 31 | Pending |
| REV-03 | Phase 33 | Pending |
| CTX-05 | Phase 32 | Pending |
| CTX-06 | Phase 32 | Pending |
| LANG-01 | Phase 32 | Pending |
| REL-01 | Phase 30 | Pending |
| REL-02 | Phase 31 | Pending |
| REL-03 | Phase 30 | Pending |

**Coverage:**
- v0.5 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-02-13*
*Last updated: 2026-02-13 after v0.5 milestone initialization*

# Requirements: Kodiai

**Defined:** 2026-02-14
**Core Value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.9 Requirements

Requirements for v0.9 Smart Dependencies & Resilience. Each maps to roadmap phases.

### Dependency Bump Detection

- [ ] **DEP-01**: Kodiai detects dependency bump PRs from title patterns, labels, and branch prefixes
- [ ] **DEP-02**: Kodiai extracts package name, old version, new version, and ecosystem from PR metadata and changed manifest files
- [ ] **DEP-03**: Kodiai classifies version bumps as major/minor/patch using semver comparison and flags breaking changes

### Security Advisory Lookup

- [ ] **SEC-01**: Kodiai queries GitHub Advisory Database for known CVEs affecting the old and new dependency versions
- [ ] **SEC-02**: Kodiai reports advisory severity and remediation info in the review summary
- [ ] **SEC-03**: Kodiai distinguishes security-motivated bumps from routine maintenance bumps

### Changelog & Release Notes

- [ ] **CLOG-01**: Kodiai resolves package to source GitHub repository and fetches releases between old and new versions
- [ ] **CLOG-02**: Kodiai detects breaking changes from changelog content (BREAKING CHANGE markers) and release notes
- [ ] **CLOG-03**: Kodiai summarizes changelog context for the LLM review prompt (bounded to prevent prompt bloat)

### Merge Confidence

- [ ] **CONF-01**: Kodiai produces a composite merge confidence score from semver analysis, advisory status, and breaking change signals
- [ ] **CONF-02**: Kodiai displays merge confidence prominently in the review summary with supporting rationale

### Timeout Resilience

- [ ] **TMO-01**: Kodiai estimates timeout risk before review based on file count, line count, and language complexity
- [ ] **TMO-02**: Kodiai auto-reduces review scope for high-risk PRs (escalate to minimal profile or reduce file count)
- [ ] **TMO-03**: Kodiai replaces generic timeout errors with informative messages showing what was/was not reviewed
- [ ] **TMO-04**: Kodiai computes dynamic timeout from PR complexity instead of using fixed 600s default

### Intelligent Retrieval

- [ ] **RET-01**: Kodiai constructs multi-signal retrieval queries using PR intent, detected languages, diff patterns, and author tier
- [ ] **RET-02**: Kodiai applies post-retrieval language-aware re-ranking to boost same-language findings and demote cross-language results

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Dependency Analysis Extensions

- **DEP-04**: Kodiai greps workspace for usage of APIs affected by breaking changes (usage analysis)
- **DEP-05**: Kodiai tracks dependency update history in knowledge store for trend analysis
- **DEP-06**: Kodiai correlates multi-package updates sharing a scope prefix

### Advanced Timeout Handling

- **TMO-05**: Kodiai detects published inline comments during execution and reports partial results on timeout (checkpoint publishing)
- **TMO-06**: Kodiai retries with reduced file scope on timeout (top 50% by risk score)

### Advanced Retrieval

- **RET-03**: Kodiai applies adaptive distance thresholds using statistical cutoff (knee-point detection)
- **RET-04**: Kodiai applies recency-weighted scoring to boost recent memories and decay older ones
- **RET-05**: Kodiai logs retrieval quality metrics (hit rates, distance distributions) to telemetry
- **RET-06**: Kodiai recognizes cross-language concept equivalence in retrieval

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full dependency tree analysis | Scope explosion — transitive deps are npm audit/Dependabot's domain |
| Automatic lockfile regeneration | Dangerous write operation, ecosystem-specific — advisory role only |
| Real-time CVE monitoring webhooks | Reimplements Dependabot; point-in-time analysis at review is sufficient |
| Streaming partial review via SSE | GitHub API is REST; CodeRabbit abandoned streaming for buffered output |
| Multi-pass review-the-review | Doubles cost; enforcement pipeline IS the validation layer |
| Custom embedding fine-tuning | Voyage Code 3 is sufficient; complexity not justified for single repo |
| Semantic AST diff for dependency changes | Infeasible at review time; use changelog as proxy |
| Predictive timeout estimation with ML | No training data; simple heuristics are sufficient and debuggable |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEP-01 | — | Pending |
| DEP-02 | — | Pending |
| DEP-03 | — | Pending |
| SEC-01 | — | Pending |
| SEC-02 | — | Pending |
| SEC-03 | — | Pending |
| CLOG-01 | — | Pending |
| CLOG-02 | — | Pending |
| CLOG-03 | — | Pending |
| CONF-01 | — | Pending |
| CONF-02 | — | Pending |
| TMO-01 | — | Pending |
| TMO-02 | — | Pending |
| TMO-03 | — | Pending |
| TMO-04 | — | Pending |
| RET-01 | — | Pending |
| RET-02 | — | Pending |

**Coverage:**
- v0.9 requirements: 17 total
- Mapped to phases: 0
- Unmapped: 17 ⚠️

---
*Requirements defined: 2026-02-14*
*Last updated: 2026-02-14 after initial definition*

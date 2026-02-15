# Requirements: Kodiai

**Defined:** 2026-02-15
**Core Value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.10 Requirements

Requirements for v0.10 Advanced Signals. Each maps to roadmap phases.

### Dependency Analysis Extensions

- [ ] **DEP-04**: Kodiai greps workspace for usage of APIs affected by breaking changes (usage analysis)
- [ ] **DEP-05**: Kodiai tracks dependency update history in knowledge store for trend analysis
- [ ] **DEP-06**: Kodiai correlates multi-package updates sharing a scope prefix

### Advanced Timeout Handling

- [ ] **TMO-05**: Kodiai accumulates partial review state during execution and publishes partial results on timeout (checkpoint publishing)
- [ ] **TMO-06**: Kodiai retries with reduced file scope on timeout (top 50% by risk score, max 1 retry)

### Advanced Retrieval

- [ ] **RET-03**: Kodiai applies adaptive distance thresholds using statistical cutoff (max-gap detection with minimum 8-candidate guard)
- [ ] **RET-04**: Kodiai applies recency-weighted scoring to boost recent memories and decay older ones (severity-aware floor)
- [ ] **RET-05**: Kodiai logs retrieval quality metrics (hit rates, distance distributions) to telemetry

### PR Intent Enhancement

- [ ] **INTENT-01**: Kodiai uses unrecognized bracket tags as component/platform focus hints in the review prompt instead of showing them as "ignored"

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Retrieval (Deferred)

- **RET-06**: Kodiai recognizes cross-language concept equivalence in retrieval — needs empirical Voyage Code 3 testing before building normalization layer

### Dependency Analysis Extensions (Deferred from v0.9)

- **DEP-04-EXT**: Kodiai uses AST-based structural analysis (not just grep) for usage detection in high-value ecosystems

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full dependency tree analysis | Scope explosion — transitive deps are npm audit/Dependabot's domain |
| Automatic lockfile regeneration | Dangerous write operation, ecosystem-specific — advisory role only |
| Real-time CVE monitoring webhooks | Reimplements Dependabot; point-in-time analysis at review is sufficient |
| Streaming partial review via SSE | GitHub API is REST; buffered output is the established pattern |
| Multi-pass review-the-review | Doubles cost; enforcement pipeline IS the validation layer |
| Custom embedding fine-tuning | Voyage Code 3 is sufficient; complexity not justified |
| Semantic AST diff for dependency changes | Infeasible at review time; use changelog as proxy |
| Predictive timeout estimation with ML | No training data; simple heuristics are sufficient and debuggable |
| Separate retrieval telemetry database | Over-engineered; extend existing telemetry schema |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEP-04 | TBD | Pending |
| DEP-05 | TBD | Pending |
| DEP-06 | TBD | Pending |
| TMO-05 | TBD | Pending |
| TMO-06 | TBD | Pending |
| RET-03 | TBD | Pending |
| RET-04 | TBD | Pending |
| RET-05 | TBD | Pending |
| INTENT-01 | TBD | Pending |

**Coverage:**
- v0.10 requirements: 9 total
- Mapped to phases: 0
- Unmapped: 9

---
*Requirements defined: 2026-02-15*
*Last updated: 2026-02-15 after initial definition*

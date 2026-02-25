# Requirements: Kodiai v0.19

**Defined:** 2026-02-25
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.19 Requirements

Requirements for v0.19 Intelligent Retrieval Enhancements. Each maps to roadmap phases.

### Language-Aware Retrieval

- [ ] **LANG-01**: Learning memory records store the programming language of their source file
- [ ] **LANG-02**: Existing learning memory records are backfilled with language classification
- [ ] **LANG-03**: Retrieval re-ranking applies language-aware boost/penalty using stored language instead of re-classifying at query time
- [ ] **LANG-04**: Double-boost risk eliminated — unified pipeline is the single location for language weighting
- [ ] **LANG-05**: Wiki pages are tagged with language affinity so language-filtered retrieval spans all corpora

### `[depends]` PR Deep Review

- [ ] **DEPS-01**: Kodiai detects `[depends]` prefix and dependency-bump patterns in PR titles automatically (e.g. "[depends] Bump zlib 1.3.2", "[Windows] Refresh fstrcmp 0.7")
- [ ] **DEPS-02**: Detection is mutually exclusive with existing Dependabot/Renovate pipeline — a PR triggers one path, not both
- [ ] **DEPS-03**: Kodiai fetches upstream changelog / release notes for the new dependency version
- [ ] **DEPS-04**: Kodiai analyzes what changed between old and new version — breaking changes, deprecations, new APIs
- [ ] **DEPS-05**: Kodiai assesses impact on the Kodi codebase — which files consume this dependency and whether they are affected by upstream changes
- [ ] **DEPS-06**: Kodiai verifies hash/URL changes, checks for removed/added patches, and validates build config changes
- [ ] **DEPS-07**: Kodiai checks if the bump introduces new transitive dependencies or version conflicts
- [ ] **DEPS-08**: Kodiai surfaces a structured review comment with version diff summary, changelog highlights relevant to Kodi, impact assessment, and action items

### CI Failure Recognition

- [ ] **CIFR-01**: Kodiai fetches CI check results for the PR head SHA using the Checks API
- [ ] **CIFR-02**: Kodiai compares CI check results against the base branch SHA to identify failures also present on base
- [ ] **CIFR-03**: Kodiai posts an annotation comment identifying which failures appear unrelated to the PR with reasoning
- [ ] **CIFR-04**: Kodiai does not block approval or lower merge confidence based on unrelated CI failures
- [ ] **CIFR-05**: Kodiai tracks historically flaky workflows/steps and uses flakiness history as a signal for unrelatedness

### Code Snippet Embedding

- [ ] **SNIP-01**: PR diff hunks are chunked at the hunk level for embedding
- [ ] **SNIP-02**: Hunk embeddings are stored in a dedicated `code_snippets` table with PR/file/line metadata
- [ ] **SNIP-03**: Content-hash caching prevents re-embedding identical hunks across PRs
- [ ] **SNIP-04**: Hunk embeddings are integrated into the cross-corpus retrieval pipeline as a fourth corpus
- [ ] **SNIP-05**: Embedding cost is bounded — only hunks from PRs that produce findings are persisted (or configurable limit)

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Retrieval Quality

- **RETQ-01**: A/B testing framework for retrieval strategies to measure quality impact
- **RETQ-02**: Retrieval quality metrics dashboard with precision/recall tracking

### CI Intelligence

- **CINT-01**: CI failure auto-retry recommendations for known-transient failures
- **CINT-02**: CI failure root-cause analysis linking failures to specific PR changes

## Out of Scope

| Feature | Reason |
|---------|--------|
| LLM-based CI failure attribution | Unreliable; deterministic heuristics + base-branch comparison preferred |
| Full CI log ingestion into review prompt | Token-wasteful; structured heuristics produce better results |
| Lower-dimensional embedding model for snippets | Unvalidated quality tradeoff; use voyage-code-3 consistently |
| Real-time CI status streaming | GitHub webhooks sufficient; no need for polling |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LANG-01 | — | Pending |
| LANG-02 | — | Pending |
| LANG-03 | — | Pending |
| LANG-04 | — | Pending |
| LANG-05 | — | Pending |
| DEPS-01 | — | Pending |
| DEPS-02 | — | Pending |
| DEPS-03 | — | Pending |
| DEPS-04 | — | Pending |
| DEPS-05 | — | Pending |
| DEPS-06 | — | Pending |
| DEPS-07 | — | Pending |
| DEPS-08 | — | Pending |
| CIFR-01 | — | Pending |
| CIFR-02 | — | Pending |
| CIFR-03 | — | Pending |
| CIFR-04 | — | Pending |
| CIFR-05 | — | Pending |
| SNIP-01 | — | Pending |
| SNIP-02 | — | Pending |
| SNIP-03 | — | Pending |
| SNIP-04 | — | Pending |
| SNIP-05 | — | Pending |

**Coverage:**
- v0.19 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 ⚠️

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 after initial definition*

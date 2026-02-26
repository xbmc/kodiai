# Requirements: Kodiai v0.20

**Defined:** 2026-02-25
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Source:** [Issue #66](https://github.com/xbmc/kodiai/issues/66)

## v0.20 Requirements

Requirements for v0.20 Multi-Model & Active Intelligence. Each maps to roadmap phases.

### Multi-LLM Routing

- [x] **LLM-01**: Non-agentic tasks (summaries, labels, scoring) route through Vercel AI SDK `generateText()` while agentic tasks (PR review, mentions, Slack write) remain on Claude Agent SDK `query()`
- [x] **LLM-02**: Task types (`pr-summary`, `cluster-label`, `staleness-evidence`) map to configurable model IDs via a task router
- [x] **LLM-03**: `.kodiai.yml` `models:` section allows per-repo model overrides per task type
- [x] **LLM-04**: Provider fallback: if configured provider is unavailable, fall back to configured default model
- [x] **LLM-05**: Each non-agentic LLM invocation logs model, provider, token counts, and estimated cost to Postgres

### Wiki Staleness Detection

- [ ] **WIKI-01**: Scheduled job compares wiki page content references against recent code changes to compute staleness scores
- [ ] **WIKI-02**: File-path-level evidence linking identifies specific code changes that invalidate wiki content with commit SHAs
- [ ] **WIKI-03**: Staleness report delivered on schedule (Slack message to `#kodiai` or GitHub issue) listing top-N stale pages with evidence
- [ ] **WIKI-04**: Staleness threshold configurable via `.kodiai.yml` `wiki.staleness_threshold_days`
- [ ] **WIKI-05**: Two-tier detection: cheap heuristic pass first, LLM evaluation only on flagged subset (capped at 20 pages/cycle)

### Review Pattern Clustering

- [x] **CLST-01**: HDBSCAN batch clustering job runs on review comment embeddings to discover emergent review themes without predefined categories
- [x] **CLST-02**: Cluster labels auto-generated from representative samples using cheap LLM via task router
- [x] **CLST-03**: Clusters with 3+ members in the last 60 days surfaced in PR review context as recurring patterns
- [x] **CLST-04**: Cluster assignments and labels persisted in Postgres with scheduled refresh (weekly)
- [x] **CLST-05**: Dimensionality reduction (UMAP or equivalent) applied before clustering to handle 1024-dim embeddings

### Contributor Profiles

- [ ] **PROF-01**: Contributor profile table stores GitHub username, Slack user ID, display name, expertise topics, and author tier
- [ ] **PROF-02**: GitHub/Slack identity linking via explicit Slack command with optional heuristic suggestions (never auto-linked)
- [ ] **PROF-03**: Expertise inference derives per-topic scores from commit history, review comment topics, and language usage
- [ ] **PROF-04**: Adaptive review depth: lighter review for high-tenure contributors in their expertise areas, more explanation for newcomers
- [ ] **PROF-05**: Privacy opt-out flag per contributor; no profile built without consent mechanism

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Cross-Platform Activity

- **ACTV-01**: Unified timeline of a contributor's GitHub PRs + Slack questions for mentoring insight
- **ACTV-02**: Activity-based contributor recommendations for code review assignments

### Advanced Wiki Intelligence

- **AWIKI-01**: Symbol-level staleness detection (function names, class names extracted from wiki prose)
- **AWIKI-02**: Wiki edit suggestions with draft content for stale sections

### Clustering Enhancements

- **ECLST-01**: Trend detection showing cluster growth/shrinkage over time
- **ECLST-02**: Cross-repo pattern comparison when multiple repos are monitored

### Retrieval Quality

- **RETQ-01**: A/B testing framework for retrieval strategies to measure quality impact
- **RETQ-02**: Retrieval quality metrics dashboard with precision/recall tracking

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time model switching mid-review | Agent SDK `query()` with MCP tools cannot swap models mid-execution |
| User-facing LLM provider selection UI | No dashboard exists; config via `.kodiai.yml` |
| Automatic cross-platform identity resolution | False positives erode trust; manual linking required |
| Wiki edit suggestions / auto-editing | Kodiai is a reviewer, not a wiki editor |
| Bedrock/Vertex/arbitrary provider auth | OAuth-only constraint for v1 |
| Full contributor dashboard | No UI surface exists |
| Real-time clustering per PR | HDBSCAN is expensive; scheduled batch only |
| Streaming AI SDK responses | Bun streaming issue (oven-sh/bun#25630); use `generateText()` only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LLM-01 | Phase 97 | Complete |
| LLM-02 | Phase 97 | Complete |
| LLM-03 | Phase 97 | Complete |
| LLM-04 | Phase 97 | Complete |
| LLM-05 | Phase 97 | Complete |
| WIKI-01 | Phase 99 | Pending |
| WIKI-02 | Phase 99 | Pending |
| WIKI-03 | Phase 99 | Pending |
| WIKI-04 | Phase 99 | Pending |
| WIKI-05 | Phase 99 | Pending |
| CLST-01 | Phase 100 | Done |
| CLST-02 | Phase 100 | Done |
| CLST-03 | Phase 100 | Done |
| CLST-04 | Phase 100 | Done |
| CLST-05 | Phase 100 | Done |
| PROF-01 | Phase 98 | Pending |
| PROF-02 | Phase 98 | Pending |
| PROF-03 | Phase 98 | Pending |
| PROF-04 | Phase 98 | Pending |
| PROF-05 | Phase 98 | Pending |

**Coverage:**
- v0.20 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 after roadmap creation*

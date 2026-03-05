# Requirements: Kodiai

**Defined:** 2026-03-03
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.25 Requirements

Requirements for Wiki Content Updates milestone. Each maps to roadmap phases.

### Embedding Migration

- [x] **EMBED-01**: Wiki corpus re-embedded atomically with voyage-context-3 (all pages, not incremental)
- [x] **EMBED-02**: Per-corpus embedding model selection — wiki uses voyage-context-3, all other corpora stay on voyage-code-3
- [x] **EMBED-03**: Wiki store parameterized to accept embedding model name instead of hardcoding voyage-code-3
- [x] **EMBED-04**: Retrieval pipeline uses correct model per corpus for query embedding

### Page Popularity

- [x] **POP-01**: MediaWiki inbound link counts fetched via `linkshere` API for all wiki pages
- [x] **POP-02**: Retrieval citation frequency tracked — counts how often each wiki page appears in retrieval results
- [x] **POP-03**: Edit recency captured as a popularity signal (more recently edited = more active)
- [x] **POP-04**: Composite popularity score combining inbound links, citation frequency, and edit recency

### Staleness Detection

- [x] **STALE-01**: Recent merged PRs (last 90 days) scanned to identify code areas with significant changes
- [x] **STALE-02**: Changed code areas matched to related wiki pages via retrieval pipeline
- [x] **STALE-03**: Diff content from PRs/commits preserved and fed to staleness analysis (not discarded)
- [x] **STALE-04**: Improved staleness precision with domain stopwords and section-heading weighting to reduce false positives

### Update Generation

- [ ] **UPDATE-01**: LLM generates section-level rewrite suggestions for stale wiki pages
- [ ] **UPDATE-02**: Suggestions grounded in actual code diff content (not fabricated — apply v0.24 epistemic lessons)
- [ ] **UPDATE-03**: Each suggestion cites the PR(s)/commit(s) that motivated the change
- [ ] **UPDATE-04**: Top 20 pages by composite popularity score processed per run

### Voice-Preserving Updates

- [ ] **VOICE-01**: Style extraction samples content from beginning, middle, and end of the page (spread sampling, not just first N tokens)
- [ ] **VOICE-02**: Style extraction explicitly catalogs wiki conventions — categories, interwiki links, navboxes, and templates
- [ ] **VOICE-03**: Style descriptions cached in DB with TTL and content-hash invalidation to avoid redundant LLM calls
- [x] **VOICE-04**: Generation prompt encourages formatting improvements (code blocks, tables, bold) for clarity instead of restricting to existing formatting elements
- [x] **VOICE-05**: Post-generation template check verifies all original {{...}} templates are preserved; retry once then drop on failure
- [x] **VOICE-06**: Heading level validation ensures generated output matches original section heading levels
- [x] **VOICE-07**: Generation prompt instructs normalization of inconsistencies and replacement of deprecated content with current equivalents

### Publishing

- [ ] **PUB-01**: Tracking issue created in xbmc/wiki repo with batch summary
- [ ] **PUB-02**: Per-page update suggestions posted as individual comments on the tracking issue
- [ ] **PUB-03**: Rate-limit-aware posting with minimum delays between comments
- [ ] **PUB-04**: GitHub App installation on xbmc/wiki verified before publishing

## Future Requirements

### Automation

- **AUTO-01**: Scheduled periodic runs (weekly/monthly) of the wiki update pipeline
- **AUTO-02**: Slack notification when new update suggestions are posted
- **AUTO-03**: Track which suggestions were accepted/applied by wiki editors

### Extended Signals

- **SIG-01**: Google Analytics integration for kodi.wiki page view data (if available)
- **SIG-02**: Cross-wiki link graph analysis for deeper popularity ranking
- **SIG-03**: User feedback on suggestion quality to improve future generations

## Out of Scope

| Feature | Reason |
|---------|--------|
| Direct wiki editing | Too risky for v0.25 — suggestions only, humans apply changes |
| MediaWiki pageview stats | kodi.wiki lacks PageViewInfo extension — research confirmed unavailable |
| Real-time staleness detection | One-shot manual trigger for v0.25; automation deferred to future |
| Multi-wiki support | Only kodi.wiki for now |
| YAML issue form schema for wiki updates | Markdown comments sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EMBED-01 | Phase 120 | Complete |
| EMBED-02 | Phase 120 | Complete |
| EMBED-03 | Phase 120 | Complete |
| EMBED-04 | Phase 120 | Complete |
| POP-01 | Phase 121 | Complete |
| POP-02 | Phase 121 | Complete |
| POP-03 | Phase 121 | Complete |
| POP-04 | Phase 121 | Complete |
| STALE-01 | Phase 122 | Complete |
| STALE-02 | Phase 122 | Complete |
| STALE-03 | Phase 122 | Complete |
| STALE-04 | Phase 122 | Complete |
| UPDATE-01 | Phase 123 | Pending |
| UPDATE-02 | Phase 123 | Pending |
| UPDATE-03 | Phase 123 | Pending |
| UPDATE-04 | Phase 123 | Pending |
| VOICE-01 | Phase 125 | Pending |
| VOICE-02 | Phase 125 | Pending |
| VOICE-03 | Phase 125 | Pending |
| VOICE-04 | Phase 125 | Complete |
| VOICE-05 | Phase 125 | Complete |
| VOICE-06 | Phase 125 | Complete |
| VOICE-07 | Phase 125 | Complete |
| PUB-01 | Phase 124 | Pending |
| PUB-02 | Phase 124 | Pending |
| PUB-03 | Phase 124 | Pending |
| PUB-04 | Phase 124 | Pending |

**Coverage:**
- v0.25 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-05 after Phase 125 voice-preserving requirements added*

# Requirements: Kodiai

**Defined:** 2026-02-26
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.22 Requirements

Requirements for v0.22 Issue Intelligence. Each maps to roadmap phases.

### Ingestion

- [ ] **INGEST-01**: User can run a backfill script that populates the issue corpus with historical xbmc/xbmc issues and their comment threads
- [ ] **INGEST-02**: Each backfilled issue is embedded via Voyage AI (title + body) and stored with HNSW-indexed vectors
- [ ] **INGEST-03**: Backfill script filters out pull requests returned by the GitHub Issues API
- [ ] **INGEST-04**: Backfill script tracks sync state for cursor-based resume on interruption
- [ ] **INGEST-05**: Backfill script logs progress with page counts, embedding counts, and rate limit status
- [ ] **INGEST-06**: Nightly sync job fetches issues updated since last sync and upserts them with fresh embeddings
- [ ] **INGEST-07**: Nightly sync job also syncs new and updated issue comments

### Duplicate Detection

- [ ] **DUPL-01**: When a new issue is triaged, the system queries the issue corpus for vector-similar candidates at high-confidence threshold
- [ ] **DUPL-02**: Top-3 duplicate candidates are presented in a comment with similarity scores, titles, numbers, and open/closed status
- [ ] **DUPL-03**: Duplicate detection never auto-closes issues — it comments and optionally applies a label
- [ ] **DUPL-04**: Duplicate detection is fail-open — embedding or search failures are logged but never block triage

### PR Linking

- [x] **PRLINK-01**: PR body and commit messages are parsed for explicit issue references (fixes, closes, relates-to patterns)
- [x] **PRLINK-02**: When no explicit references are found, semantic search finds related issues from the corpus
- [x] **PRLINK-03**: Linked issue context is included in PR review prompts for richer review feedback
- [x] **PRLINK-04**: Issue corpus is wired as a source in cross-corpus RRF retrieval with `[issue: #N]` citations

### Auto-Triage

- [ ] **TRIAGE-01**: `issues.opened` webhook event triggers the triage pipeline automatically
- [ ] **TRIAGE-02**: Auto-triage is gated behind `triage.autoTriageOnOpen` config flag (default: false)
- [ ] **TRIAGE-03**: Auto-triage includes duplicate detection in the triage flow
- [ ] **TRIAGE-04**: Auto-triage is idempotent — webhook dedup, in-flight claim, and per-issue cooldown prevent duplicate comments

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Classification

- **CLASS-01**: Automatic area classification labels based on issue content
- **CLASS-02**: Per-repo label taxonomy configuration in `.kodiai.yml`

### Assignment

- **ASSIGN-01**: Suggested assignee based on contributor profiles and area labels

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Auto-close duplicate issues | False-positive closures destroy trust; comment + label only |
| Auto-assign issues | Social complexity, accuracy requirements too high for v0.22 |
| Auto-close for template violations | Alienates new contributors; guidance + label is sufficient |
| YAML issue form schema | xbmc/xbmc uses `.md` templates; no target repo needs YAML forms |
| Cross-repo duplicate detection | Different repos have different contexts; scope to same repo |
| Real-time duplicate detection on every comment | Only initial issue body matters; trigger on `issues.opened` only |
| Automated issue prioritization/severity | Subjective; surface data but let humans prioritize |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INGEST-01 | Phase 106 | Pending |
| INGEST-02 | Phase 106 | Pending |
| INGEST-03 | Phase 106 | Pending |
| INGEST-04 | Phase 106 | Pending |
| INGEST-05 | Phase 106 | Pending |
| INGEST-06 | Phase 106 | Pending |
| INGEST-07 | Phase 106 | Pending |
| DUPL-01 | Phase 107 | Pending |
| DUPL-02 | Phase 107 | Pending |
| DUPL-03 | Phase 107 | Pending |
| DUPL-04 | Phase 107 | Pending |
| PRLINK-01 | Phase 108 | Complete |
| PRLINK-02 | Phase 108 | Complete |
| PRLINK-03 | Phase 108 | Complete |
| PRLINK-04 | Phase 109 | Complete |
| TRIAGE-01 | Phase 107 | Pending |
| TRIAGE-02 | Phase 107 | Pending |
| TRIAGE-03 | Phase 107 | Pending |
| TRIAGE-04 | Phase 107 | Pending |

**Coverage:**
- v0.22 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after roadmap creation*

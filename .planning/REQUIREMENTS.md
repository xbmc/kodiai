# Requirements: Kodiai

**Defined:** 2026-02-26
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.21 Requirements

Requirements for Issue Triage Foundation. Each maps to roadmap phases.

### Issue Corpus

- [ ] **ICORP-01**: Issue schema migration adds `issues` table with HNSW and tsvector indexes to PostgreSQL
- [ ] **ICORP-02**: IssueVectorStore factory provides typed CRUD and vector search interface matching existing store patterns

### MCP Tools

- [ ] **MCPT-01**: `github_issue_label` MCP tool applies labels to issues with label existence validation and 404 handling
- [ ] **MCPT-02**: `github_issue_comment` MCP tool posts comments on issues without review-specific validators
- [ ] **MCPT-03**: Both MCP tools wired into executor MCP server registry with config gating and integration tests

### Triage Agent

- [ ] **TRIA-01**: Issue template parser reads `.md` templates from `.github/ISSUE_TEMPLATE/`, extracts required sections, diffs against issue body
- [ ] **TRIA-02**: Triage agent validates issue body against template, generates structured guidance comment and label recommendations
- [ ] **TRIA-03**: Triage wired to `@kodiai` mention path for issues, gated by `.kodiai.yml` `triage.enabled`, with label allowlist and per-issue cooldown

## Future Requirements

### Issue Intelligence (v0.22)

- **IINT-01**: Auto-triage on `issues.opened` event (configurable, default off)
- **IINT-02**: Semantic duplicate detection using issue vector corpus
- **IINT-03**: Area classification with configurable label taxonomy
- **IINT-04**: Issue backfill populates corpus with historical issues

### Interactive Troubleshooting (v0.23)

- **ITSH-01**: Multi-turn issue debugging conversations
- **ITSH-02**: Codebase-aware issue response with retrieval context

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-close on template violations | Anti-feature — even VS Code only auto-closes after 60 days on low-vote items |
| Auto-fire on `issues.opened` | Deferred to v0.22; mention-triggered gives repos explicit control |
| YAML issue form schema support | xbmc/xbmc uses `.md` templates; defer YAML forms until a target repo needs them |
| Issue corpus wired into retrieval | Build schema now, wire into cross-corpus search in v0.22 |
| Semantic duplicate detection | Requires populated corpus; v0.22 feature |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ICORP-01 | — | Pending |
| ICORP-02 | — | Pending |
| MCPT-01 | — | Pending |
| MCPT-02 | — | Pending |
| MCPT-03 | — | Pending |
| TRIA-01 | — | Pending |
| TRIA-02 | — | Pending |
| TRIA-03 | — | Pending |

**Coverage:**
- v0.21 requirements: 8 total
- Mapped to phases: 0
- Unmapped: 8 ⚠️

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after initial definition*

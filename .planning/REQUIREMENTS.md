# Requirements: Kodiai

**Defined:** 2026-02-11
**Core Value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback — inline review comments with suggestion blocks, or contextual answers to questions — without requiring any workflow setup in the target repo.

## v0.4 Requirements

Requirements for intelligent review system. Each maps to roadmap phases.

### Foundation: Review Mode & Severity Control

- [ ] **FOUND-01**: User can configure review mode (standard/enhanced) with standard as default
- [ ] **FOUND-02**: User can set minimum severity level (critical/major/medium/minor) via config
- [ ] **FOUND-03**: User can specify focus areas (security, bugs, performance, maintainability) via config
- [ ] **FOUND-04**: Every review comment is tagged with severity level and issue category
- [ ] **FOUND-05**: Review enforces hard cap of 5-7 inline comments maximum per PR
- [ ] **FOUND-06**: Review prompt includes explicit noise suppression rules (no style-only, no trivial renaming)

### Context Awareness

- [ ] **CTX-01**: User can define path-scoped review instructions in .kodiai.yml (different rules per directory)
- [ ] **CTX-02**: User can select review profile preset (strict/balanced/minimal) via config
- [ ] **CTX-03**: System performs deterministic diff analysis (file classification, risk signals) before review
- [ ] **CTX-04**: Review prompt is enriched with diff analysis context and repo-specific instructions

### Learning & Feedback

- [ ] **LEARN-01**: System stores review findings and feedback in SQLite knowledge store
- [ ] **LEARN-02**: User can configure explicit suppression patterns (issues to stop flagging) via config
- [ ] **LEARN-03**: User can set minimum confidence threshold to filter low-confidence findings
- [ ] **LEARN-04**: Review summary includes metrics (files, lines, issues by severity, time estimate)
- [ ] **LEARN-05**: System captures implicit feedback via comment reactions (thumbs up/down) for learning

## v0.5 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Learning

- **LEARN-06**: System uses embedding-based clustering to improve false positive detection
- **LEARN-07**: System integrates Voyage AI embeddings for similarity-based feedback matching
- **LEARN-08**: System supports incremental re-review (only new changes, not full PR)

### Multi-Language Support

- **CTX-05**: Diff analyzer supports language-specific patterns beyond TypeScript
- **CTX-06**: Review prompt includes language-specific best practices for major languages

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| ML-based learning from past reviews | Requires feedback corpus, training pipeline, concept drift management. Explicit config-based learning is more predictable for self-hosted tool. |
| Auto-fix from review findings | Conflates review (advisory) with write-mode (action). Keep separation. GitClear shows AI reviewing own output = 8x code duplication. |
| Cross-repo architectural analysis | Product unto itself. Stay within single-PR scope. |
| Integrated linter/SAST orchestration | Let CI/CD handle linters. LLM focuses on issues static tools miss. |
| Multi-agent review pipeline | Doubles/triples cost and latency. Claude handles triage + analysis + formatting in one pass. |
| Tree-sitter AST parsing | Native addon complexity, duplicates Claude's built-in code understanding via Read/Grep/Glob. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 26 | Pending |
| FOUND-02 | Phase 26 | Pending |
| FOUND-03 | Phase 26 | Pending |
| FOUND-04 | Phase 26 | Pending |
| FOUND-05 | Phase 26 | Pending |
| FOUND-06 | Phase 26 | Pending |
| CTX-01 | Phase 27 | Pending |
| CTX-02 | Phase 27 | Pending |
| CTX-03 | Phase 27 | Pending |
| CTX-04 | Phase 27 | Pending |
| LEARN-01 | Phase 28 | Pending |
| LEARN-02 | Phase 28 | Pending |
| LEARN-03 | Phase 28 | Pending |
| LEARN-04 | Phase 28 | Pending |
| LEARN-05 | Phase 29 | Pending |

**Coverage:**
- v0.4 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-02-11*
*Last updated: 2026-02-11 after roadmap creation*

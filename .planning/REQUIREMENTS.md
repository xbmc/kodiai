# Requirements: Kodiai

**Defined:** 2026-02-16
**Core Value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.12 Requirements

Requirements for v0.12 Operator Reliability and Retrieval Quality. Each maps to roadmap phases.

### Operator Reliability

- [x] **OPS-01**: Search-based enrichment stays within the 30/min Search API budget through repository-scoped caching and request de-duplication.
- [ ] **OPS-02**: When rate limits are approached or exceeded, Kodiai degrades gracefully (bounded retries, reduced scope, and explicit user-facing messaging).
- [ ] **OPS-03**: Rate-limit behavior is observable with telemetry fields that support production tuning (cache hit rate, skipped queries, retry outcomes).

### Retrieval Quality

- [ ] **RET-07**: Kodiai supports multi-query retrieval for review and mention flows (intent, code-shape, and file-path variants) with deterministic merge/rerank.
- [ ] **RET-08**: Retrieved context includes concise code-snippet evidence and path anchors without exceeding prompt budget limits.

### Conversational UX

- [ ] **CONV-01**: Conversational follow-up behavior is consistent across issue, PR, and review-comment surfaces with surface-appropriate tone and structure.
- [ ] **CONV-02**: When context is insufficient, Kodiai asks one targeted clarifying question instead of producing speculative guidance.

## Future Requirements

Deferred to a future milestone.

- **SLACK-01**: Slack integration for `#kodiai` thread-only support.
- **LLM-01**: Multi-LLM pluggable providers (Codex CLI, etc.).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Continuous background indexing daemon | Increases operational complexity; keep indexing request-driven for v0.12 |
| Automatic retries beyond one degraded attempt | Higher risk of API thrash and duplicate noise |
| Cross-repository conversational memory | Privacy and scope risk for private repos |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OPS-01 | Phase 66 | Satisfied |
| OPS-02 | Phase 67 | Pending |
| OPS-03 | Phase 67 | Pending |
| RET-07 | Phase 68 | Pending |
| RET-08 | Phase 69 | Pending |
| CONV-01 | Phase 70 | Pending |
| CONV-02 | Phase 70 | Pending |

**Coverage:**
- v0.12 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0

---
*Requirements defined: 2026-02-16*
*Last updated: 2026-02-16 -- marked OPS-01 satisfied after phase 66 verification*

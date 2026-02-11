# Requirements: Kodiai v0.3

**Defined:** 2026-02-11
**Core Value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.

## v0.3 Requirements

Requirements for enhanced configuration and usage telemetry. Each maps to roadmap phases.

### Enhanced Configuration

- [ ] **CONFIG-01**: Remove `.strict()` from config sub-schemas without breaking existing repos
- [ ] **CONFIG-02**: Config validation provides graceful degradation (section-level fallback to defaults)
- [ ] **CONFIG-03**: User can disable PR auto-review via `review.enabled: false`
- [ ] **CONFIG-04**: User can skip PRs touching only certain paths via `review.skipPaths: ["docs/**", "*.md"]`
- [ ] **CONFIG-05**: User can control silent approvals via `review.autoApprove: true/false`
- [ ] **CONFIG-06**: User can disable @kodiai mentions via `mentions.enabled: false`
- [ ] **CONFIG-07**: User can restrict mentions to allowlist via `mentions.allowedUsers: ["alice", "bob"]`
- [ ] **CONFIG-08**: User can allow write-mode only in specific paths via `writeMode.allowPaths: ["src/**"]`
- [ ] **CONFIG-09**: User can block write-mode in specific paths via `writeMode.denyPaths: [".github/**", "infra/**"]`
- [ ] **CONFIG-10**: User can opt-out of telemetry collection via `telemetry.enabled: false`
- [ ] **CONFIG-11**: User receives warning when execution cost exceeds threshold via `telemetry.costWarningUsd: 2.0`

### Usage Telemetry

- [ ] **TELEM-01**: ExecutionResult includes full SDK data (tokens, modelUsage, costUsd, duration, stopReason)
- [ ] **TELEM-02**: Telemetry storage layer exists (SQLite with executions table)
- [ ] **TELEM-03**: Handlers capture telemetry after execution completes
- [ ] **TELEM-04**: Telemetry record includes: deliveryId, repo, prNumber, eventType, provider, model, inputTokens, outputTokens, durationMs, costUsd
- [ ] **TELEM-05**: Telemetry writes are fire-and-forget (non-blocking, do not delay next job)
- [ ] **TELEM-06**: SQLite uses WAL mode for concurrent read/write safety
- [ ] **TELEM-07**: Telemetry storage has 90-day retention policy (auto-deletes old rows)
- [ ] **TELEM-08**: SQLite WAL checkpoint runs periodically (on server startup + every 1000 writes)

### Reporting Tools

- [ ] **REPORT-01**: CLI script exists at `scripts/usage-report.ts`
- [ ] **REPORT-02**: Report supports time filtering via `--since 7d` or `--since 2026-01-01`
- [ ] **REPORT-03**: Report supports repo filtering via `--repo owner/name`
- [ ] **REPORT-04**: Report shows aggregate metrics: total executions, total tokens (input/output), total cost
- [ ] **REPORT-05**: Report shows top repos by cost (ranked list)
- [ ] **REPORT-06**: Report supports JSON output via `--json` flag
- [ ] **REPORT-07**: Report supports CSV output via `--csv` flag
- [ ] **REPORT-08**: Report shows avg duration per event type (review vs mention)

## Future Requirements

Deferred to v0.4 or later.

### Slack Integration

- **SLACK-01**: Kodiai responds to `@kodiai` mentions in Slack #kodiai channel
- **SLACK-02**: Responses are thread-only (never top-level channel posts)
- **SLACK-03**: Default repo context is `xbmc/xbmc`
- **SLACK-04**: Repo context can be overridden in message text
- **SLACK-05**: Rate limits prevent spam (5 req/5min per user, 10 msg/thread)

### Multi-LLM Support

- **LLM-01**: Kodiai can execute via ChatGPT Plus/Pro using Codex CLI
- **LLM-02**: User can select provider via `.kodiai.yml` (`llm.defaultProvider: "codex-cli"`)
- **LLM-03**: User can configure monthly budget via `.kodiai.yml` (`llm.budgets.monthlyUsd: 100`)
- **LLM-04**: Kodiai auto-fallbacks to secondary provider when primary fails or exceeds budget
- **LLM-05**: Usage records show provider/model for every execution

## Out of Scope

Explicitly excluded from v0.3. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real-time dashboard UI | CLI reporting sufficient for small user group; avoid frontend complexity |
| External telemetry services (Datadog, New Relic) | SQLite sufficient for single replica; defer until multi-replica |
| Per-user cost attribution | Installation-level only for v0.3; user-level tracking adds complexity |
| Budget enforcement (hard limits) | Warnings only for v0.3; hard stops require additional UX (how to unblock?) |
| Config UI / web-based settings | File-based config only; avoid building admin panel |
| Distributed locks / Redis | Single replica only; defer until scaling needed |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONFIG-01 | Phase 22 | Pending |
| CONFIG-02 | Phase 22 | Pending |
| CONFIG-03 | Phase 24 | Pending |
| CONFIG-04 | Phase 24 | Pending |
| CONFIG-05 | Phase 24 | Pending |
| CONFIG-06 | Phase 24 | Pending |
| CONFIG-07 | Phase 24 | Pending |
| CONFIG-08 | Phase 24 | Pending |
| CONFIG-09 | Phase 24 | Pending |
| CONFIG-10 | Phase 24 | Pending |
| CONFIG-11 | Phase 24 | Pending |
| TELEM-01 | Phase 23 | Pending |
| TELEM-02 | Phase 23 | Pending |
| TELEM-03 | Phase 23 | Pending |
| TELEM-04 | Phase 23 | Pending |
| TELEM-05 | Phase 23 | Pending |
| TELEM-06 | Phase 23 | Pending |
| TELEM-07 | Phase 23 | Pending |
| TELEM-08 | Phase 23 | Pending |
| REPORT-01 | Phase 25 | Pending |
| REPORT-02 | Phase 25 | Pending |
| REPORT-03 | Phase 25 | Pending |
| REPORT-04 | Phase 25 | Pending |
| REPORT-05 | Phase 25 | Pending |
| REPORT-06 | Phase 25 | Pending |
| REPORT-07 | Phase 25 | Pending |
| REPORT-08 | Phase 25 | Pending |

**Coverage:**
- v0.3 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-02-11*
*Last updated: 2026-02-11 after roadmap creation*

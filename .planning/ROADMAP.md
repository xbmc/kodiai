# Roadmap: Kodiai

## Milestones

- ✅ **v0.1 MVP** -- shipped 2026-02-09 (Phases 1-10)
  - Archive: `.planning/milestones/v0.1-ROADMAP.md`
- ✅ **v0.2 Write Mode** -- shipped 2026-02-10 (Phases 11-21)
- ✅ **v0.3 Configuration & Observability** -- shipped 2026-02-11 (Phases 22-25)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 22: Config Validation Safety** - Make config parsing forward-compatible and failure-resilient before adding new fields -- completed 2026-02-11
- [ ] **Phase 23: Telemetry Foundation** - Build persistent telemetry storage with capture pipeline so every execution is recorded
- [x] **Phase 24: Enhanced Config Fields** - Add user-facing controls for review, mention, write-mode, and telemetry behavior -- completed 2026-02-11
- [x] **Phase 25: Reporting Tools** - CLI script that queries telemetry storage and surfaces usage/cost metrics for operators -- completed 2026-02-11

## Phase Details

### Phase 22: Config Validation Safety
**Goal**: Config parsing accepts unknown fields without error and recovers gracefully from invalid sections, so existing repos never break when Kodiai adds new config capabilities
**Depends on**: Nothing (first phase of v0.3)
**Requirements**: CONFIG-01, CONFIG-02
**Success Criteria** (what must be TRUE):
  1. A `.kodiai.yml` containing unknown keys (e.g., `futureFeature: true`) is accepted without error -- the unknown keys are silently ignored
  2. A `.kodiai.yml` with a valid `review` section but an invalid `write` section loads the valid review config and falls back to defaults for the broken write section (partial failure, not total failure)
  3. A repo with no `.kodiai.yml` at all continues to work with all defaults (zero-config preserved)
  4. When a section falls back to defaults due to validation error, a warning is logged identifying which section failed and why
**Plans**: 1 plan

Plans:
- [x] 22-01-PLAN.md -- Remove .strict(), implement two-pass safeParse with graceful degradation, update call sites and tests -- completed 2026-02-11

### Phase 23: Telemetry Foundation
**Goal**: Every Kodiai execution (review, mention, write) records token usage, cost, and duration to persistent storage, with retention and concurrency safety built in from day one
**Depends on**: Phase 22
**Requirements**: TELEM-01, TELEM-02, TELEM-03, TELEM-04, TELEM-05, TELEM-06, TELEM-07, TELEM-08
**Success Criteria** (what must be TRUE):
  1. After a PR review completes, a telemetry row exists in SQLite containing: deliveryId, repo, prNumber, eventType, model, inputTokens, outputTokens, costUsd, and durationMs
  2. After a mention execution completes, the same telemetry fields are recorded (same schema, different eventType)
  3. Telemetry writes do not delay the next queued job -- a slow or failed write never blocks the critical path
  4. Rows older than 90 days are automatically deleted (retention policy enforced on startup or periodically)
  5. The SQLite database uses WAL mode and can be read by an external process (the CLI tool) while the server is running
**Plans**: 3 plans

Plans:
- [x] 23-01-PLAN.md -- TDD: TelemetryStore with SQLite storage, WAL mode, retention purge, and checkpoint -- completed 2026-02-11
- [x] 23-02-PLAN.md -- Enrich ExecutionResult with token usage, model, and stopReason from SDK -- completed 2026-02-11
- [x] 23-03-PLAN.md -- Wire TelemetryStore into server startup and both handlers with fire-and-forget capture -- completed 2026-02-11

### Phase 24: Enhanced Config Fields
**Goal**: Users can fine-tune Kodiai behavior per-repo via `.kodiai.yml` -- disabling reviews, restricting mentions, scoping write-mode paths, and controlling telemetry
**Depends on**: Phase 22 (safe validation), Phase 23 (telemetry exists for CONFIG-10, CONFIG-11)
**Requirements**: CONFIG-03, CONFIG-04, CONFIG-05, CONFIG-06, CONFIG-07, CONFIG-08, CONFIG-09, CONFIG-10, CONFIG-11
**Success Criteria** (what must be TRUE):
  1. Setting `review.enabled: false` in `.kodiai.yml` causes Kodiai to skip PR auto-review entirely for that repo (no comments, no approval)
  2. Setting `review.skipPaths: ["docs/**"]` causes Kodiai to skip review when all changed files match the skip patterns
  3. Setting `mentions.enabled: false` causes Kodiai to ignore all @kodiai mentions in that repo
  4. Setting `mentions.allowedUsers: ["alice"]` causes Kodiai to respond only to alice's mentions and ignore everyone else's
  5. Setting `writeMode.allowPaths` / `writeMode.denyPaths` restricts which files write-mode can modify, and attempts outside those paths are blocked
**Plans**: 2 plans

Plans:
- [x] 24-01-PLAN.md -- Add allowedUsers to mention config, upgrade skipPaths to picomatch globs, add tests -- completed 2026-02-11
- [x] 24-02-PLAN.md -- Add telemetry config section with opt-out control and cost warning threshold in both handlers -- completed 2026-02-11

### Phase 25: Reporting Tools
**Goal**: Operators can query telemetry data via a CLI script to understand usage patterns, costs, and identify expensive repos
**Depends on**: Phase 23 (telemetry storage must exist with data)
**Requirements**: REPORT-01, REPORT-02, REPORT-03, REPORT-04, REPORT-05, REPORT-06, REPORT-07, REPORT-08
**Success Criteria** (what must be TRUE):
  1. Running `bun scripts/usage-report.ts` prints a summary showing total executions, total tokens, and total cost
  2. Running with `--since 7d` filters to only the last 7 days of data; `--since 2026-01-01` filters from a specific date
  3. Running with `--repo owner/name` filters to a single repo
  4. Running with `--json` outputs structured JSON; `--csv` outputs CSV -- both suitable for piping to other tools
  5. The report includes a ranked list of repos by cost (top consumers visible at a glance)

**Plans**: 1 plan

Plans:
- [x] 25-01-PLAN.md -- Create usage-report.ts CLI script with aggregate queries, filtering, multi-format output, and build integration -- completed 2026-02-11

## Progress

**Execution Order:**
Phases execute in numeric order: 22 -> 23 -> 24 -> 25

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 22. Config Validation Safety | v0.3 | 1/1 | ✓ Complete | 2026-02-11 |
| 23. Telemetry Foundation | v0.3 | 3/3 | ✓ Complete | 2026-02-11 |
| 24. Enhanced Config Fields | v0.3 | 2/2 | ✓ Complete | 2026-02-11 |
| 25. Reporting Tools | v0.3 | 1/1 | ✓ Complete | 2026-02-11 |

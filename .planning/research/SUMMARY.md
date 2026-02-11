# Project Research Summary

**Project:** Kodiai v0.3 - Enhanced Config + Usage Telemetry
**Domain:** GitHub App enhancement (config schema evolution, cost tracking)
**Researched:** 2026-02-11
**Confidence:** HIGH

## Executive Summary

Kodiai v0.3 adds enhanced configuration control and usage telemetry to an existing, production GitHub App. Research confirms this is a well-understood domain: configuration evolution via schema validation (Zod) and telemetry via lightweight persistent storage (SQLite). The recommended approach leverages Bun's built-in capabilities (bun:sqlite) and existing infrastructure (Zod v4, Pino logging) to add zero new npm dependencies while providing operators with cost visibility and users with fine-grained control.

The architecture integrates cleanly at established boundaries: config validation happens in loadRepoConfig(), telemetry capture happens after executor.execute() returns, and storage is a new standalone module that handlers call fire-and-forget. The core risk is breaking existing repos through config schema changes -- particularly Zod's .strict() on sub-schemas which rejects future field additions. Prevention requires removing .strict() from user-facing schemas and implementing graceful degradation for invalid config sections.

The research reveals a clear critical path: fix config validation forward-compatibility (remove .strict()) before adding new fields, build telemetry storage with retention policy from day one, and ensure persistent volume mounting for production value. The system requires minimal new code and follows established patterns throughout.

## Key Findings

### Recommended Stack

All capabilities needed for v0.3 are either already installed or built into Bun. No new npm dependencies required.

**Core technologies:**
- **bun:sqlite (built-in)**: Telemetry storage -- zero dependencies, 3-6x faster than better-sqlite3, WAL mode for safe concurrent access
- **Zod v4 (^4.3.6, installed)**: Config schema validation -- existing patterns work, needs .strict() removal for forward-compatibility
- **Pino v10 (^10.3.0, installed)**: Structured logging -- existing usage already captures telemetry fields, SQLite adds persistence
- **Bun script (built-in)**: CLI reporting tool -- queries SQLite directly, outputs table/JSON/CSV formats

**Critical version notes:**
- Zod v4's .strict() is deprecated but functional; however, using it on user-facing schemas breaks forward-compatibility
- bun:sqlite requires Bun >= 1.0 (current installation is 1.3.8)
- WAL mode + busy_timeout = 5000 required for safe concurrent reads (server writes, CLI reads)

### Expected Features

**Must have (table stakes):**
- **Config validation with clear errors** -- already built via Zod .strict(), needs graceful degradation enhancement
- **Per-execution cost/token recording** -- Agent SDK provides total_cost_usd and modelUsage, must persist to storage
- **Per-execution metadata** -- repo, PR, event type, conclusion, timestamp, session ID for correlation
- **CLI usage report with time filtering** -- operators need "cost last 7/30 days" without parsing logs
- **mention.allowedUsers config field** -- restrict who can burn tokens via @mention (blocklist insufficient)

**Should have (competitive advantage):**
- **Per-model token breakdown in telemetry** -- Agent SDK modelUsage provides per-model cost insights unavailable in competitor SaaS tools
- **Cost-per-PR aggregation** -- group executions by PR number to answer "what did this PR cost?" (key ROI metric per Tribe AI guide)
- **Report output formats (table/JSON/CSV)** -- table for humans, JSON for piping, CSV for spreadsheets
- **review.skipLabels config field** -- skip review for labeled PRs (dependencies, wip, skip-review)
- **telemetry.costWarningUsd** -- log warning when single execution exceeds threshold (early warning, not hard limit)

**Defer (v2+):**
- **review.severity threshold** -- filter comments by severity level (requires structured output or prompt engineering)
- **JSONL export for log aggregation** -- Grafana/Datadog integration (overkill for current scale)
- **Retention pruning beyond 90 days** -- database size projectable at ~3.5 MB/year, premature optimization
- **Path-specific review instructions** -- CodeRabbit-style per-path prompts (adds complexity for unclear user demand)

### Architecture Approach

Integration follows the principle: modify at boundaries, add layers -- don't restructure. The existing webhook -> handler -> executor -> MCP pipeline is clean and requires only boundary enhancements.

**Major components:**

1. **Config validation enhancement (modify existing)** -- Remove .strict() from user-facing sub-schemas, add graceful degradation for invalid sections, improve error formatting for GitHub comment display
2. **Telemetry capture (enrich ExecutionResult)** -- Executor already extracts costUsd/numTurns/sessionId from Agent SDK result; add inputTokens, outputTokens, cacheReadInputTokens, durationApiMs, model, stopReason
3. **Storage layer (new standalone module)** -- TelemetryStore interface with SQLite backend, idempotent schema creation, 90-day retention policy, WAL mode + checkpointing
4. **Handler integration (modify existing)** -- After executor.execute() returns, handlers call telemetryStore.record() fire-and-forget with full context (owner, repo, PR, event type, delivery ID)
5. **CLI reporting tool (new script)** -- scripts/usage-report.ts queries SQLite read-only, aggregates by repo/PR/type/date, outputs table/JSON/CSV

**Data flow:** Webhook -> Handler loads config (now with graceful degradation) -> Executor enriches ExecutionResult -> Handler records telemetry (fire-and-forget) -> CLI queries storage.

### Critical Pitfalls

1. **Strict Zod sub-schemas reject future config keys** -- Current codebase uses .strict() on write, secretScan, mention, and review.triggers sub-objects. Adding ANY new key causes existing repos to error. Prevention: remove .strict() from all user-facing schemas before adding fields, use .passthrough() or default strip behavior, test forward-compatibility with unknown keys.

2. **Config validation errors block critical paths** -- loadRepoConfig() throws on any Zod error, aborting entire review/mention. A typo in write-mode config breaks all reviews. Prevention: implement section-level fallback parsing (parse each section independently on full parse failure), log warnings for invalid sections, continue with defaults for failed sections.

3. **Logging PII in telemetry records** -- Temptation to add prompts, PR bodies, file paths for debugging creates privacy violations and storage bloat. Prevention: strict telemetry schema allowlist (timestamp, repo, PR number, event type, tokens, cost, duration, conclusion, model, session ID ONLY), never store user content or file paths.

4. **Unbounded telemetry storage growth** -- SQLite grows forever without retention policy; WAL files grow independently without checkpointing. Prevention: 90-day retention DELETE + VACUUM on startup/periodic timer, PRAGMA wal_checkpoint(TRUNCATE) after cleanup, PRAGMA wal_autocheckpoint = 1000 (4MB pages).

5. **Telemetry collection blocking critical path** -- Database writes in the p-queue job callback add latency to every job; write failures cause job failures. Prevention: fire-and-forget writes (void writeTelemetry().catch()), never await in critical path, handle storage failures gracefully (log warning, never throw).

## Implications for Roadmap

Based on research, suggested phase structure follows the critical path: config safety first, then telemetry foundation, then reporting.

### Phase 1: Config Validation Enhancement

**Rationale:** Must come first to prevent breaking existing repos when adding new fields. Config changes are self-contained with no new modules. Smallest, safest change.

**Delivers:**
- Remove .strict() from user-facing sub-schemas (write, mention, review.triggers)
- Graceful degradation: section-level fallback parsing
- Improved error formatting for GitHub comments
- Forward-compatibility test suite (unknown keys, minimal config, golden configs)

**Addresses:**
- Pitfall 1 (strict schemas reject future keys)
- Pitfall 2 (no graceful degradation)
- Pitfall 7 (schema migration breaks existing files)
- Pitfall 10 (missing defaults break zero-config repos)

**Avoids:** Breaking existing repos when adding mention.allowedUsers, review.skipLabels, telemetry.* in later phases.

### Phase 2: Telemetry Foundation (Storage + Capture)

**Rationale:** Establishes persistent storage and data capture before adding config fields that depend on telemetry (costWarningUsd). Dependencies: Phase 1 complete (config changes tested).

**Delivers:**
- TelemetryRecord type definition
- Enriched ExecutionResult with Agent SDK fields (inputTokens, outputTokens, cacheReadInputTokens, durationApiMs, model, stopReason)
- TelemetryStore interface + SQLite backend
- Database initialization (idempotent schema, WAL mode, busy_timeout)
- 90-day retention policy + WAL checkpointing
- Handler integration (fire-and-forget record calls)
- Persistent volume configuration (Azure Files mount)

**Uses:** bun:sqlite (built-in), existing ExecutionResult type, existing handler boundaries

**Implements:** Storage layer architecture (new module), telemetry capture architecture (executor enrichment)

**Addresses:**
- Pitfall 3 (PII in telemetry) via strict schema allowlist
- Pitfall 4 (unbounded growth) via retention policy from day one
- Pitfall 5 (cost drift) via storing Agent SDK total_cost_usd directly
- Pitfall 6 (blocking critical path) via fire-and-forget writes
- Pitfall 8 (database locking) via WAL mode + busy_timeout
- Pitfall 9 (errored executions lose data) via nullable cost/turns fields
- Pitfall 12 (data loss on restart) via persistent volume

### Phase 3: Enhanced Config Fields

**Rationale:** Adds user-facing config control now that validation is safe (Phase 1) and telemetry exists for costWarningUsd (Phase 2). Dependencies: Phase 1 + Phase 2 complete.

**Delivers:**
- mention.allowedUsers (array of GitHub usernames, default empty = allow all)
- review.skipLabels (array of label names to skip review)
- telemetry.enabled (boolean, default true, master switch)
- telemetry.costWarningUsd (number, default 0 = disabled, log warning if execution exceeds)
- Config validation tests for all new fields
- Documentation for new fields

**Addresses:**
- mention.allowedUsers (table stakes feature)
- review.skipLabels (competitive feature)
- telemetry.costWarningUsd (competitive feature bridging config + telemetry)

**Avoids:** Schema breaking changes (Phase 1 foundation prevents this)

### Phase 4: CLI Reporting Tool

**Rationale:** Provides operator visibility into telemetry data. Can be built as soon as storage exists (Phase 2), even before config fields (Phase 3). No dependencies on Phase 3.

**Delivers:**
- scripts/usage-report.ts
- Query filters: --since (7d/30d/YYYY-MM-DD), --repo, --type (review/mention/write)
- Output formats: --format (table/json/csv)
- Group by: --group-by (repo/pr/type/day)
- Report sections: summary, by-grouping, top-5 expensive, error rate
- Read-only SQLite access (no write contention)

**Uses:** bun:sqlite (read-only mode), shared telemetry types module

**Implements:** CLI reporting architecture (standalone script, minimal imports)

**Addresses:**
- Pitfall 11 (module coupling) via shared types with no server dependencies
- Table stakes feature: CLI usage report with time filtering

### Phase Ordering Rationale

- **Phase 1 first:** Config validation safety is a prerequisite for all schema changes. Must not break existing repos.
- **Phase 2 before Phase 3:** telemetry.costWarningUsd config field requires telemetry storage to exist. Storage must be in place before the config field is added.
- **Phase 3 and Phase 4 parallelizable:** Config fields (Phase 3) and CLI reporting (Phase 4) do not depend on each other. Can be built in parallel after Phase 2.
- **Critical path:** Phase 1 -> Phase 2 -> {Phase 3 || Phase 4}. Phases 3 and 4 can run concurrently.

### Research Flags

Phases likely needing deeper research during planning:
- **None** -- All four phases use established patterns with high-confidence sources. Stack is already installed or built-in. Architecture integrates at clear boundaries. Pitfalls are well-documented with concrete prevention strategies.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Config)** -- Zod schema evolution is well-documented, codebase already uses the patterns
- **Phase 2 (Telemetry)** -- bun:sqlite API verified, Agent SDK result message fields documented, storage patterns standard
- **Phase 3 (Config fields)** -- Extends existing repoConfigSchema using same .default() pattern
- **Phase 4 (Reporting)** -- SQLite queries with aggregations, standard CLI argument parsing

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | bun:sqlite verified working with smoke tests, Zod v4 installed and inspected, Pino in active use. No new dependencies required. |
| Features | HIGH | Agent SDK cost tracking authoritative per Anthropic docs. CodeRabbit/AI Review config patterns documented. Tribe AI ROI metric guidance specific. |
| Architecture | HIGH | Full codebase inspection (executor, handlers, config loader, types). Integration points identified with existing boundaries. No speculation. |
| Pitfalls | HIGH | Zod .strict() forward-compatibility issue documented in real-world case study. SQLite WAL/retention patterns standard. PII/privacy guidance from Microsoft/OneUptime. |

**Overall confidence:** HIGH

### Gaps to Address

**No significant gaps.** Research was exhaustive with official source verification. Minor areas needing validation during implementation:

- **Persistent volume setup on Azure Container Apps** -- Research confirms Azure Files mount is standard practice, but actual configuration (storage account, file share name, mount path) needs Azure portal/CLI verification during deployment. Not a research gap, an infrastructure task.
- **Optimal SQLite checkpoint frequency** -- PRAGMA wal_autocheckpoint = 1000 is the recommended starting point, but exact value may need tuning based on actual write volume. Start with 1000, monitor WAL file size in production, adjust if needed.
- **Error comment formatting for config errors** -- Research identifies the need for "friendlier error formatting" but does not specify exact markdown structure. Implementation should format as a code block with field-level errors, potentially with a link to documentation. Defer exact format to PR review.

## Sources

### Primary (HIGH confidence)

**Codebase inspection:**
- `/home/keith/src/kodiai/package.json` -- Verified installed versions (Bun 1.3.8, Zod ^4.3.6, Pino ^10.3.0, Hono, Octokit, Agent SDK)
- `/home/keith/src/kodiai/src/execution/config.ts` -- Documented .strict() usage on lines 41, 44, 82, 111; existing Zod patterns
- `/home/keith/src/kodiai/src/execution/executor.ts` -- Identified ExecutionResult fields and Agent SDK result message extraction
- `/home/keith/src/kodiai/src/execution/types.ts` -- ExecutionResult type definition
- `/home/keith/src/kodiai/src/handlers/review.ts` -- Telemetry logging at line 462-473
- `/home/keith/src/kodiai/src/handlers/mention.ts` -- Telemetry logging at line 673-686
- `/home/keith/src/kodiai/src/lib/logger.ts` -- createChildLogger() arbitrary field support

**Official documentation:**
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite) -- Full API reference, WAL mode, transactions
- [Bun SQLite API reference](https://bun.com/reference/bun/sqlite) -- Database class, prepared statements, type mapping
- [Zod v4 migration guide](https://zod.dev/v4/changelog) -- .strict() deprecation status, .default() behavior
- [Zod v4 release notes](https://zod.dev/v4) -- Breaking changes, new features
- [Pino API documentation](https://github.com/pinojs/pino/blob/main/docs/api.md) -- Child loggers, custom fields
- [Anthropic Agent SDK Cost Tracking](https://platform.claude.com/docs/en/api/agent-sdk/cost-tracking) -- total_cost_usd, modelUsage fields (authoritative)
- [Anthropic Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing) -- Current model pricing
- [SQLite WAL Mode Documentation](https://sqlite.org/wal.html) -- Concurrent read/write behavior, checkpoint mechanics
- [CodeRabbit Configuration Reference](https://docs.coderabbit.ai/reference/configuration) -- Competitive config schema patterns

### Secondary (MEDIUM confidence)

- [Bun SQLite guide (OneUptime, 2026)](https://oneuptime.com/blog/post/2026-01-31-bun-sqlite/view) -- WAL mode setup patterns
- [Pino logger guide (SigNoz, 2026)](https://signoz.io/guides/pino-logger/) -- Structured logging for telemetry
- [Tribe AI: Measuring Claude Code ROI](https://www.tribe.ai/applied-ai/a-quickstart-for-measuring-the-return-on-your-claude-code-investment) -- Cost-per-PR as primary metric
- [Claude Flow Token Tracking Telemetry](https://github.com/ruvnet/claude-flow/wiki/Token-Tracking-Telemetry) -- Community token tracking patterns
- [Zod .strict() forward-compatibility issue (opencode #6145)](https://github.com/anomalyco/opencode/issues/6145) -- Real-world case study of exact pitfall
- [Litestream WAL Truncate Threshold Guide](https://litestream.io/guides/wal-truncate-threshold/) -- WAL checkpoint best practices
- [Keep PII Out of Your Telemetry (OneUptime)](https://oneuptime.com/blog/post/2025-11-13-keep-pii-out-of-observability-telemetry/view) -- Privacy in observability
- [Microsoft Engineering Playbook: Privacy in Logging](https://microsoft.github.io/code-with-engineering-playbook/observability/logs-privacy/) -- PII avoidance patterns

### Tertiary (LOW confidence)

- [AI Review GitHub](https://github.com/Nikita-Filonov/ai-review) -- Alternative config schema examples (informational, not authoritative)
- [9 Best GitHub AI Code Review Tools 2026](https://www.codeant.ai/blogs/best-github-ai-code-review-tools-2025) -- Ecosystem overview (not used for technical decisions)

---
*Research completed: 2026-02-11*
*Ready for roadmap: yes*

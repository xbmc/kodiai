# Feature Research: Enhanced Config + Usage Telemetry

**Domain:** GitHub App config schema and usage telemetry (v0.3 milestone)
**Researched:** 2026-02-11
**Confidence:** HIGH

## Scope

This research covers **new features only** for the v0.3 milestone. Already-built capabilities (PR auto-review, @mention handling, write-mode, basic `.kodiai.yml` config, webhook event routing) are treated as existing infrastructure, not features to be researched.

The four feature areas:
1. Enhanced `.kodiai.yml` schema -- giving users control over review/mention/write behavior
2. Usage telemetry -- recording token consumption, cost, and duration per execution
3. Cost estimation -- converting raw token counts to dollar amounts
4. Reporting -- CLI tool for querying and summarizing usage data

## Feature Landscape

### Table Stakes (Operators and Users Expect These)

Features that operators (you) and users expect from a tool that claims "config control + cost visibility."

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Config validation with clear errors** | Users who mistype a key or use a wrong type must get a clear error, not silent misbehavior. Already implemented via Zod `.strict()` + error formatting. | ALREADY BUILT | `zod`, `js-yaml` |
| **Sensible defaults for every config field** | Users who provide an empty `.kodiai.yml` or no config file should get safe, useful behavior. All fields must have defaults. Already implemented. | ALREADY BUILT | `repoConfigSchema` defaults |
| **Per-execution cost recording** | The Agent SDK already returns `total_cost_usd` on the result message. This data is authoritative (per Anthropic docs) and must be persisted, not just logged. Without persistence, you lose cost visibility on restart. | LOW | `executor.ts` result message, storage layer |
| **Per-execution token recording** | Token counts (input, output, cache read, cache creation) are returned per model via `modelUsage` on the result message. Operators need this to understand *why* a session was expensive. | LOW | Agent SDK `modelUsage` field, storage layer |
| **Per-execution duration recording** | Wall-clock duration is already computed in `executor.ts` (`durationMs`). Must be persisted alongside cost/tokens. | LOW | `executor.ts` already computes this |
| **Per-execution metadata** | Each telemetry record must capture: repo, PR number, event type (review/mention/write), delivery ID, session ID, conclusion (success/failure/error), and timestamp. Without metadata, aggregate queries are impossible. | LOW | All fields already available in handler context |
| **CLI usage report** | Operators must be able to query: "How much did this cost in the last 7 days?" and "Which repo is most expensive?" without parsing raw logs. A simple `bun scripts/usage-report.ts --since 7d` is the minimum. | MEDIUM | Storage layer, telemetry records |
| **Report filtering by time range** | `--since 7d`, `--since 30d`, `--since 2026-01-01` are the minimum filters. Without time filtering, reports are useless at scale. | LOW | CLI argument parsing |
| **mention.allowedUsers config field** | Users expect to restrict who can trigger @mention responses. Without this, any contributor can burn tokens by @mentioning the bot. CodeRabbit's `auto_review.ignore_usernames` is the inverse pattern (blocklist); an allowlist is safer for a small-user tool. | LOW | `repoConfigSchema`, mention handler gate |

### Differentiators (Competitive Advantage)

Features that go beyond baseline expectations and provide real operator/user value.

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Per-model token breakdown in telemetry** | The Agent SDK's `modelUsage` provides per-model cost/token breakdowns. Storing this enables insight into "how much did Haiku subagents cost vs the main Sonnet model?" -- impossible with just `total_cost_usd`. No competitors expose this granularity for self-hosted tools. | LOW | Agent SDK `modelUsage` map, JSON column in storage |
| **Cost-per-PR aggregation in reports** | "This PR cost $2.34 across 3 executions (1 review + 2 mentions)." Grouping by `owner/repo#prNumber` and summing cost gives the single most useful operator metric. The [Tribe AI guide](https://www.tribe.ai/applied-ai/a-quickstart-for-measuring-the-return-on-your-claude-code-investment) identifies cost-per-PR as the primary ROI metric. | LOW | Telemetry records with PR number, GROUP BY query |
| **Report output in multiple formats** | Table (human-readable), JSON (machine-parseable), CSV (spreadsheet import). JSON is critical for piping into other tools. | LOW | Formatting logic in CLI script |
| **review.skipLabels config field** | Skip review for PRs with specific labels (e.g., `skip-review`, `wip`, `dependencies`). CodeRabbit supports this via `auto_review.labels` / `ignore_title_keywords`. Useful for Dependabot PRs and draft labels. | LOW | `repoConfigSchema`, review handler gate, GitHub API label fetch |
| **Configurable review.severity threshold** | Let users set minimum severity for comments: `severity: high` means only critical/high issues get inline comments; lower-severity findings are suppressed or collected into a summary. Reduces noise for teams that only want important findings. | MEDIUM | Prompt engineering + config field, unclear how to enforce reliably without structured output |
| **Execution cost budget / warning threshold** | Config field like `costWarningUsd: 5.0` that logs a warning or posts a comment when a single execution exceeds the threshold. Defense against runaway sessions. | LOW | Simple check in executor post-processing |
| **Telemetry export to stdout JSON lines** | `bun scripts/usage-report.ts --format jsonl` for log aggregation pipelines. Each record is a newline-delimited JSON object. Enables integration with external monitoring (Grafana, Datadog) without requiring OpenTelemetry setup. | LOW | Report formatting option |

### Anti-Features (Do NOT Build)

Features that seem useful but create complexity disproportionate to their value for a small-user, self-hosted tool.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **OpenTelemetry export infrastructure** | "Use OTEL for proper observability." | Requires running a collector, configuring OTLP endpoints, and maintaining Prometheus/Grafana. Massive ops overhead for a single-instance tool with a few users. Claude Code's native OTEL support is for *interactive CLI* usage, not GitHub App pipelines. | SQLite + CLI reports. If you later need Grafana, export JSONL and ingest it. Do not build OTEL infra now. |
| **Web dashboard for usage metrics** | "A real-time dashboard showing cost per repo." | Building a web UI for a CLI-queryable dataset adds frontend dependencies (React/HTML), auth, hosting, and maintenance. The audience is 1-3 operators who can run a CLI command. | CLI reports with `--format table` and `--format json`. If a dashboard is ever needed, pipe JSONL into Grafana Cloud (free tier). |
| **Per-user billing / chargeback** | "Track cost per GitHub user for internal billing." | Adds user identity tracking, raises privacy concerns, and requires a billing reconciliation system. Overkill for a private tool with a small known user group. | Track cost per repo and per event type. If you need user-level data, add `triggerUser` to telemetry records (already available from webhook payload) and query ad-hoc. |
| **Real-time cost alerts (Slack/email)** | "Alert me when monthly spend exceeds $X." | Requires notification infrastructure (Slack webhook, email service), cron scheduling, and threshold configuration. | Log warnings when single-execution cost exceeds threshold (the `costWarningUsd` config field). For monthly totals, run the CLI report weekly. |
| **Config schema versioning / migration** | "Version the YAML schema and auto-migrate old configs." | The config schema is small and stable. Zod `.default()` already handles missing fields gracefully. Schema versioning adds complexity for a problem that does not exist yet. | Keep using Zod defaults. If a breaking change is ever needed, document it in release notes and let the Zod error messages guide users. |
| **Dynamic config reloading without restart** | "Watch `.kodiai.yml` for changes and hot-reload." | Config is loaded per-execution from the workspace clone, not from a persistent file. Each webhook event clones the repo and reads the config fresh. Hot-reload is already the default behavior -- changing config in the repo takes effect on the next PR event. | Document that config changes take effect on next event (already true). No work needed. |
| **Path-specific review instructions** | "Different review prompts for `src/api/` vs `src/ui/`." | CodeRabbit supports this but it adds schema complexity, prompt construction logic, and path-matching infrastructure. For a small user group, a single `review.prompt` field suffices. | Defer. If users request it, add `review.pathInstructions: [{path: "src/api/**", prompt: "Focus on auth"}]` later. |
| **Mention allowedUsers as GitHub team resolution** | "Allow `@my-org/core-team` instead of listing individual users." | Requires GitHub API calls to resolve team membership on every mention event. Adds latency and API rate limit consumption. | Use flat username lists. Teams are small enough that listing users explicitly is fine. |

## Feature Dependencies

```
[Enhanced .kodiai.yml Schema]
    |
    +-- review.skipLabels
    |       +--requires--> GitHub API to fetch PR labels (already available via Octokit)
    |
    +-- mention.allowedUsers
    |       +--requires--> mention handler gate check (trivial: array.includes)
    |
    +-- costWarningUsd
            +--requires--> telemetry recording (to compare against threshold)

[Usage Telemetry]
    |
    +-- Storage layer (SQLite via bun:sqlite)
    |       +--requires--> Database initialization on app startup
    |       +--requires--> Schema migration (single CREATE TABLE, no ORM)
    |
    +-- Recording hook in executor
    |       +--requires--> Storage layer
    |       +--requires--> Agent SDK result message fields (already available)
    |
    +-- CLI report script
            +--requires--> Storage layer
            +--requires--> SQLite queries with date filtering

[Cost Estimation]
    |
    +-- Already solved: Agent SDK total_cost_usd is authoritative
    +-- Per-model breakdown via modelUsage (store as JSON)

[CLI Reporting]
    |
    +-- Depends on: Storage layer with telemetry records
    +-- Filters: --since, --repo, --type (review/mention/write)
    +-- Formats: table (default), json, csv
    +-- Aggregations: total cost, cost per repo, cost per PR, cost per event type
```

### Dependency Notes

- **Telemetry recording must exist before reporting can work.** The storage layer is the critical path item.
- **Config enhancements are independent of telemetry.** They can be built in parallel.
- **`costWarningUsd` bridges config and telemetry** -- it is a config field that reads telemetry data (execution cost from the result message) to decide whether to warn.
- **`review.skipLabels` requires an API call** that the review handler does not currently make. The handler has Octokit access, so this is a single added REST call, not a new dependency.

## Config Schema: What to Add

Based on analysis of the existing `repoConfigSchema` in `src/execution/config.ts` and patterns from CodeRabbit, AI Review, and similar tools:

### Fields to Add to Existing Sections

**`review` section additions:**

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `skipLabels` | `string[]` | `[]` | Skip review when PR has any of these labels. Common: `["skip-review", "dependencies", "wip"]` |

**`mention` section additions:**

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `allowedUsers` | `string[]` | `[]` (empty = allow all) | When non-empty, only these GitHub usernames can trigger @mention responses. Empty means unrestricted. |

### New Top-Level Section

**`telemetry` section (NEW):**

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `enabled` | `boolean` | `true` | Master switch for telemetry recording. Operators can disable if they do not want any data stored. |
| `costWarningUsd` | `number` | `0` (disabled) | When > 0, log a warning if a single execution exceeds this cost. Does not block execution. |

### Fields NOT to Add (Rationale)

| Rejected Field | Why Not |
|----------------|---------|
| `review.maxCostUsd` (hard limit) | Aborting mid-review wastes the tokens already spent and leaves the user with no output. A warning is better than a kill switch. |
| `review.model` per-section | The top-level `model` field already controls this. Per-section model overrides add complexity without clear user need. |
| `mention.blockedUsers` | An allowlist (`allowedUsers`) is safer and simpler than maintaining both allow + block lists. |
| `telemetry.retentionDays` | SQLite file size for a small-user tool will be negligible. Add retention pruning only if the DB grows unexpectedly. |
| `review.pathInstructions` | Deferred. Single `review.prompt` field suffices for now. |

## Telemetry Schema: What to Record

Based on analysis of the Agent SDK's result message structure, the [Anthropic cost tracking docs](https://platform.claude.com/docs/en/api/agent-sdk/cost-tracking), and the [Claude Flow telemetry approach](https://github.com/ruvnet/claude-flow/wiki/Token-Tracking-Telemetry):

### Per-Execution Record

| Field | Type | Source | Purpose |
|-------|------|--------|---------|
| `id` | `INTEGER PRIMARY KEY` | Auto-increment | Row identifier |
| `timestamp` | `TEXT (ISO 8601)` | `new Date().toISOString()` | When execution completed |
| `deliveryId` | `TEXT` | Webhook event `X-GitHub-Delivery` header | Correlate with webhook logs |
| `installationId` | `INTEGER` | Webhook payload | Group by GitHub App installation |
| `owner` | `TEXT` | Handler context | Repository owner |
| `repo` | `TEXT` | Handler context | Repository name |
| `prNumber` | `INTEGER NULL` | Handler context | NULL for issue-only mentions |
| `eventType` | `TEXT` | Handler context | `review`, `mention`, or `write` |
| `conclusion` | `TEXT` | `ExecutionResult.conclusion` | `success`, `failure`, `error` |
| `costUsd` | `REAL NULL` | `resultMessage.total_cost_usd` | Authoritative cost from Agent SDK |
| `durationMs` | `INTEGER NULL` | `resultMessage.duration_ms` or fallback | Wall-clock execution time |
| `numTurns` | `INTEGER NULL` | `resultMessage.num_turns` | Agent loop iterations |
| `sessionId` | `TEXT NULL` | `resultMessage.session_id` | Agent SDK session identifier |
| `model` | `TEXT` | `config.model` | Primary model used |
| `modelUsage` | `TEXT NULL (JSON)` | `JSON.stringify(resultMessage.modelUsage)` | Per-model token/cost breakdown |
| `errorMessage` | `TEXT NULL` | `ExecutionResult.errorMessage` | Only for errored executions |
| `isTimeout` | `INTEGER (0/1)` | `ExecutionResult.isTimeout` | Quick filter for timeouts |
| `triggerUser` | `TEXT NULL` | Webhook payload sender login | Who triggered this execution |

### Why SQLite, Not JSON File

| Criterion | SQLite (bun:sqlite) | JSON File |
|-----------|---------------------|-----------|
| Concurrent writes | Safe (WAL mode) | Race conditions on concurrent appends |
| Query capability | Full SQL (GROUP BY, date ranges, aggregations) | Must load entire file, filter in JS |
| Performance | bun:sqlite is 3-6x faster than better-sqlite3 | Degrades linearly with file size |
| Disk format | Single file, portable, crash-safe | Single file, but no crash safety |
| Already a dependency | `bun:sqlite` is built into Bun (zero install) | `fs` is built into Bun (zero install) |

**Recommendation: SQLite via `bun:sqlite`.** Zero new dependencies. Built-in to Bun. SQL queries make the CLI report script trivial.

## CLI Report: What to Support

### Command Interface

```
bun scripts/usage-report.ts [options]

Options:
  --since <period>     Time filter: "7d", "30d", "2026-01-01" (default: "7d")
  --repo <owner/repo>  Filter by repository (optional)
  --type <type>        Filter by event type: review, mention, write (optional)
  --format <format>    Output format: table, json, csv (default: "table")
  --group-by <field>   Group results: repo, pr, type, day (default: "repo")
```

### Report Sections (Table Format)

1. **Summary**: Total executions, total cost, total tokens, date range
2. **By grouping**: Cost/count breakdown by the `--group-by` field
3. **Top 5 most expensive executions**: Individual records sorted by cost descending
4. **Error rate**: Count of errored/timed-out executions vs total

### Example Output

```
Usage Report: 2026-02-04 to 2026-02-11
=======================================

Summary:
  Executions:    47
  Total cost:    $12.83
  Avg cost:      $0.27
  Total tokens:  1,247,392
  Errors:        2 (4.3%)
  Timeouts:      1 (2.1%)

By Repository:
  owner/repo-a       31 executions    $8.42    65.6%
  owner/repo-b       16 executions    $4.41    34.4%

Top 5 Most Expensive:
  $1.23  owner/repo-a #142  mention  2026-02-10T14:32:00Z
  $0.89  owner/repo-a #138  review   2026-02-09T09:15:00Z
  ...
```

## MVP Definition

### Build Now (v0.3)

Minimum viable set for "config control + cost visibility."

- [ ] **Telemetry storage layer** (SQLite via bun:sqlite) -- Critical path. All reporting depends on this.
- [ ] **Recording hook in executor** -- Capture every execution's result into SQLite after completion.
- [ ] **mention.allowedUsers config field** -- Users need to restrict who can burn tokens via @mentions.
- [ ] **CLI usage report with --since filter** -- Operators need "how much did this cost last week?"
- [ ] **telemetry.costWarningUsd config field** -- Warn when a single execution is expensive.
- [ ] **report --format table and --format json** -- Human-readable and machine-parseable output.

### Add After Validation (v0.3.x)

Features to add once the core telemetry pipeline is working.

- [ ] **review.skipLabels** -- Useful but requires an additional API call per review event. Add when users request it.
- [ ] **report --group-by pr** -- Cost-per-PR aggregation. Add when there is enough data to make this useful.
- [ ] **report --format csv** -- Spreadsheet export. Add if operators want to share reports.
- [ ] **telemetry.enabled: false support** -- Disable telemetry entirely. Add if any user requests it (default-on is the right starting point).
- [ ] **Per-model token breakdown in reports** -- Requires parsing the stored `modelUsage` JSON. Add when operators want to optimize model selection.

### Future Consideration (v0.4+)

- [ ] **review.severity threshold** -- Requires structured output from the LLM or post-processing of review comments. Non-trivial to implement reliably.
- [ ] **JSONL export for log aggregation** -- Add if operators want Grafana/Datadog integration.
- [ ] **Retention pruning (delete old records)** -- Add if SQLite file grows beyond ~100MB (unlikely for small user group).
- [ ] **Path-specific review instructions** -- Deferred from the initial FEATURES.md. Only build if users request it.

## Feature Prioritization Matrix

| Feature | User/Operator Value | Implementation Cost | Priority |
|---------|---------------------|---------------------|----------|
| Telemetry storage layer (SQLite) | HIGH (prerequisite) | MEDIUM (1 day) | P1 |
| Recording hook in executor | HIGH (prerequisite) | LOW (half day) | P1 |
| mention.allowedUsers config field | HIGH (token protection) | LOW (half day) | P1 |
| CLI usage report (--since, --format table/json) | HIGH (core visibility) | MEDIUM (1 day) | P1 |
| telemetry.costWarningUsd | MEDIUM (early warning) | LOW (hour) | P1 |
| review.skipLabels | MEDIUM (noise reduction) | LOW (half day) | P2 |
| report --group-by pr | MEDIUM (ROI insight) | LOW (hour) | P2 |
| report --format csv | LOW (export) | LOW (hour) | P2 |
| Per-model breakdown in reports | LOW (optimization) | LOW (half day) | P2 |
| review.severity threshold | MEDIUM (noise reduction) | HIGH (uncertain) | P3 |
| JSONL export | LOW (integration) | LOW (hour) | P3 |
| Retention pruning | LOW (maintenance) | LOW (hour) | P3 |

**Priority key:**
- P1: Must have for v0.3 milestone
- P2: Should have, add soon after
- P3: Future consideration

## Competitor Feature Analysis (Config + Telemetry Focus)

| Feature | CodeRabbit | AI Review | Claude Flow | Kodiai (Our Approach) |
|---------|------------|-----------|-------------|----------------------|
| YAML config in repo | `.coderabbit.yaml` (extensive schema) | `.ai-review.yaml` / `.ai-review.json` | N/A | `.kodiai.yml` (Zod-validated, strict) |
| Config validation | JSON Schema (`schema.v2.json`) | Partial | N/A | Zod `.strict()` with clear error messages |
| Path filtering (review) | `path_filters` with glob + negation | File exclude patterns | N/A | `review.skipPaths` (already built) |
| Author filtering | `auto_review.ignore_usernames` | Not documented | N/A | `review.skipAuthors` (already built) |
| Label-based skip | `auto_review.labels` | Not documented | N/A | `review.skipLabels` (planned) |
| Mention user restriction | Not configurable | N/A | N/A | `mention.allowedUsers` (planned) |
| Custom review prompts | `path_instructions` (per-path) | Custom prompt templates | N/A | `review.prompt` (already built) |
| Cost tracking | SaaS billing dashboard | Not applicable | Token usage JSON + CSV reports | SQLite + CLI reports |
| Token tracking | SaaS (opaque) | N/A | Per-session token metrics | Per-execution with modelUsage breakdown |
| Cost-per-PR metric | Not exposed | N/A | Documented as key metric | CLI `--group-by pr` aggregation |
| Telemetry storage | Cloud (SaaS) | N/A | JSON files + CSV exports | SQLite (bun:sqlite, zero deps) |

### Key Insight

CodeRabbit's config is far more extensive (40+ linter integrations, path-specific instructions, AST rules, Jira/Linear integration) -- but it serves enterprise teams paying $24-30/user/month. Kodiai serves a small, known user group. The right strategy is a lean config schema that covers the 80% case (enable/disable, filters, prompts) without the enterprise complexity. Similarly, CodeRabbit hides all telemetry behind their SaaS billing -- Kodiai's self-hosted model means operators need direct access to cost data, which is a feature CodeRabbit cannot offer.

## Sources

- [CodeRabbit Configuration Reference](https://docs.coderabbit.ai/reference/configuration) -- Full YAML schema with all available settings (HIGH confidence)
- [Anthropic Agent SDK Cost Tracking Docs](https://platform.claude.com/docs/en/api/agent-sdk/cost-tracking) -- Authoritative docs for `total_cost_usd`, `modelUsage`, and token fields (HIGH confidence)
- [Claude Flow Token Tracking Telemetry](https://github.com/ruvnet/claude-flow/wiki/Token-Tracking-Telemetry) -- Community approach to token tracking with Claude API (MEDIUM confidence)
- [Tribe AI: Measuring Claude Code ROI](https://www.tribe.ai/applied-ai/a-quickstart-for-measuring-the-return-on-your-claude-code-investment) -- Cost-per-PR methodology and OTEL setup guide (MEDIUM confidence)
- [Bun SQLite Documentation](https://bun.com/docs/runtime/sqlite) -- bun:sqlite API reference (HIGH confidence)
- [AI Review GitHub](https://github.com/Nikita-Filonov/ai-review) -- Alternative config schema patterns (MEDIUM confidence)
- [9 Best GitHub AI Code Review Tools 2026](https://www.codeant.ai/blogs/best-github-ai-code-review-tools-2025) -- Ecosystem overview (LOW confidence)
- [Claude Code + OpenTelemetry + Grafana Guide](https://quesma.com/blog/track-claude-code-usage-and-limits-with-grafana-cloud/) -- OTEL integration approach (MEDIUM confidence, rejected for complexity)

---
*Feature research for: Enhanced config schema + usage telemetry (v0.3 milestone)*
*Researched: 2026-02-11*

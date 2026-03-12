# S03: Architecture & Operations Docs — Research

**Date:** 2026-03-11

## Summary

S03 owns three documentation requirements: R008 (architecture.md), R009 (configuration.md), R011 (deployment.md consolidation + docs index). The codebase is well-structured with clear module boundaries — the challenge is distilling 212 source files across 20+ directories into accurate, contributor-friendly documentation.

The docs/ directory already exists with `deployment.md` (moved by S01) and 13 operational runbooks/smoke-test records. No conceptual documentation exists. The task is purely writing — no code changes needed.

The repo config schema (`src/execution/config.ts`, 911 lines) is the single source of truth for R009. It uses Zod schemas with inline defaults and JSDoc, making it straightforward to document every `.kodiai.yml` option mechanically.

## Recommendation

Write three docs files and one index, all from scratch:

1. **docs/architecture.md** — System overview, module map, request lifecycle (webhook → filter → router → handler → executor → LLM → publish), data flow, key abstractions (stores, retriever, task router). Keep it high-level with a module reference table.
2. **docs/configuration.md** — Generated from `src/execution/config.ts` Zod schema. Document every `.kodiai.yml` key with type, default, and description. Separate from app-level env vars (already in `.env.example`).
3. **docs/deployment.md** — Already moved by S01. Review for accuracy, consolidate any missing info from runbooks, add cross-links.
4. **docs/README.md** — Index page linking all docs files including existing runbooks.

Approach: read source → write docs → verify file existence and cross-references.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Config schema reference | `src/execution/config.ts` Zod schemas | Authoritative source with defaults, types, and validation rules inline |
| App config reference | `src/config.ts` + `.env.example` | Lists all 26 env vars with categories |
| Module inventory | `src/index.ts` (774 lines) | Shows every factory call, dependency wiring, and initialization order |

## Existing Code and Patterns

- `src/index.ts` — The orchestration entry point. Shows full dependency graph: config → auth → stores → handlers → routes → server. Essential for architecture.md's "how components connect" section.
- `src/execution/config.ts` (911 lines) — Complete `.kodiai.yml` schema with Zod. Has two-pass safeParse (full schema → per-section fallback). Every field has a default and many have JSDoc comments.
- `src/config.ts` (107 lines) — App-level config from env vars (GitHub credentials, Slack tokens, ports). Small and simple.
- `src/webhook/router.ts` — Event router pattern: Map-based registry keyed by `event.action`, bot filtering, Promise.allSettled dispatch.
- `src/handlers/review.ts` (4030 lines) — Primary handler: webhook → job queue → workspace clone → config load → diff analysis → prompt build → executor → publish inline comments + summary.
- `src/handlers/mention.ts` (2587 lines) — Conversational handler: webhook → surface detection → context build → executor with MCP tools → sanitize → publish reply.
- `src/execution/executor.ts` (335 lines) — LLM execution engine wrapping Agent SDK/AI SDK based on task router decisions.
- `src/knowledge/retrieval.ts` (867 lines) — Unified retrieval pipeline: multi-query → embed → search 5 corpora → cross-corpus RRF merge → rerank.
- `src/knowledge/store.ts` (680 lines) — Knowledge store for review findings, run state, prior review data.
- `src/llm/task-router.ts` (121 lines) — Routes task types to models with fallback chain.
- `src/routes/health.ts` — Three health endpoints: `/healthz` (DB), `/health` (alias), `/readiness` (GitHub API).
- `src/lifecycle/shutdown-manager.ts` — Graceful shutdown with SIGTERM/SIGINT handling, drain window, webhook queue persistence.
- `docs/deployment.md` — Already in docs/ (moved by S01). Covers Azure Container Apps deploy, secrets, scaling, probes.
- `docs/runbooks/` — 6 operational runbooks (mentions debug, review_requested debug, scale, slack integration, xbmc cutover, xbmc ops).
- `docs/smoke/` — 6 smoke test/UAT records from various phases.

## Constraints

- **No code changes** — this slice is pure documentation writing.
- **Must be accurate to current codebase** — post-S02 state (TS fixes done, helper extraction done, review.ts is 4030 lines, mention.ts is 2587 lines).
- **docs/deployment.md already exists** — S01 moved it. Only needs review and cross-linking, not rewriting.
- **Audience is open-source contributors** — not operators or internal team. Architecture doc should explain "how does this work" not "how to debug production."
- **Config docs must match Zod schema exactly** — defaults, types, and nesting must mirror `src/execution/config.ts`.
- **S04 will add knowledge-system.md, issue-intelligence.md, guardrails.md** — architecture.md should reference the knowledge system at a high level and defer details to S04's docs.
- **S05 will create README.md and CONTRIBUTING.md** — docs/README.md is just the docs index, not the project README.

## Architecture Overview (from source analysis)

### Module Map

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `src/auth/` | GitHub App auth, bot user client | `github-app.ts`, `bot-user.ts` |
| `src/webhook/` | Ingress: verify, dedup, filter, route | `verify.ts`, `dedup.ts`, `filters.ts`, `router.ts` |
| `src/handlers/` | Event handlers (review, mention, triage, feedback, etc.) | `review.ts`, `mention.ts`, 8 more handlers |
| `src/execution/` | LLM execution, prompt building, config loading | `executor.ts`, `config.ts`, `review-prompt.ts`, `mention-prompt.ts` |
| `src/llm/` | Model routing, cost tracking, provider abstraction | `task-router.ts`, `cost-tracker.ts`, `providers.ts` |
| `src/knowledge/` | 5-corpus knowledge system (63 files) | `retrieval.ts`, `store.ts`, `memory-store.ts`, many corpus stores |
| `src/jobs/` | Job queue, workspace manager, fork manager | `queue.ts`, `workspace.ts`, `fork-manager.ts` |
| `src/lib/` | Shared utilities (sanitizer, formatters, parsers, guardrails) | ~40 files |
| `src/enforcement/` | Severity floors, tooling detection/suppression | `severity-floors.ts`, `tooling-detection.ts` |
| `src/feedback/` | Reaction-based feedback aggregation | `aggregator.ts`, `confidence-adjuster.ts` |
| `src/contributor/` | Author profiling and tier calculation | `profile-store.ts`, `tier-calculator.ts` |
| `src/triage/` | Issue duplicate detection, template parsing | `duplicate-detector.ts`, `triage-agent.ts` |
| `src/slack/` | Slack assistant, write runner, client | `assistant-handler.ts`, `write-runner.ts` |
| `src/telemetry/` | Execution telemetry, rate limit events | `store.ts`, `types.ts` |
| `src/db/` | PostgreSQL client, migrations | `client.ts`, `migrate.ts` |
| `src/lifecycle/` | Request tracking, graceful shutdown, webhook queue | `shutdown-manager.ts`, `request-tracker.ts` |
| `src/routes/` | HTTP route handlers (webhooks, health, Slack) | `webhooks.ts`, `health.ts`, `slack-events.ts` |

### Request Lifecycle (Review)

1. GitHub sends webhook to `POST /webhooks/github`
2. `verify.ts` validates HMAC signature
3. `dedup.ts` checks delivery ID uniqueness
4. `filters.ts` drops bot/self events (allow-list bypass)
5. `router.ts` dispatches to registered handler by `event.action`
6. `review.ts` handler: enqueues job in `queue.ts` (per-installation concurrency:1)
7. Job callback: `workspace.ts` clones repo, `config.ts` loads `.kodiai.yml`
8. Diff analysis, prompt building, executor invocation
9. `executor.ts` routes through `task-router.ts` to Agent SDK / AI SDK
10. LLM generates review findings
11. Handler publishes inline comments + summary comment via GitHub API
12. Knowledge store records findings, telemetry records execution metrics

### Data Layer

- PostgreSQL (single connection pool via `src/db/client.ts`)
- pgvector for embedding storage and similarity search
- All stores share the same `sql` connection
- Migrations in `src/db/migrations/`

## Configuration Documentation Structure

The `.kodiai.yml` schema has these top-level sections (from `repoConfigSchema`):
- `model` — Default LLM model (string, default: `claude-sonnet-4-5-20250929`)
- `maxTurns` — Max agentic turns (number, 1-100, default: 25)
- `timeoutSeconds` — Execution timeout (number, 30-1800, default: 600)
- `systemPromptAppend` — Custom system prompt suffix (string, optional)
- `models` — Per-task-type model overrides (record<string, string>)
- `defaultModel` / `defaultFallbackModel` — Global model routing
- `write` — Write-mode config (enabled, allowPaths, denyPaths, minIntervalSeconds, secretScan)
- `review` — Review config (~25 fields: triggers, autoApprove, skipPaths, severity, focusAreas, maxComments, suppressions, pathInstructions, profile, outputLanguage, etc.)
- `mention` — Mention config (enabled, acceptClaudeAlias, allowedUsers, prompt, conversation limits)
- `telemetry` — Telemetry config (enabled, costWarningUsd)
- `knowledge` — Knowledge config (shareGlobal, sharing, embeddings, retrieval with hunkEmbedding)
- `languageRules` — Severity floors, tooling overrides
- `largePR` — Large PR triage thresholds and risk weights
- `feedback` — Auto-suppression thresholds
- `timeout` — Dynamic timeout config
- `triage` — Issue triage config (duplicateThreshold, labels, troubleshooting)
- `guardrails` — Epistemic guardrail strictness

## Common Pitfalls

- **Documenting stale information** — The codebase has evolved through 25 milestones. Verify every claim against current source, not DECISIONS.md historical entries.
- **Over-detailing the knowledge system** — S04 owns docs/knowledge-system.md. Architecture.md should give a one-paragraph overview of the 5-corpus pipeline and link forward.
- **Missing nested config defaults** — The Zod schema has deeply nested defaults (e.g., `review.severity.minLevel` defaults to "minor"). Must traverse the full schema tree.
- **Conflating app config and repo config** — `src/config.ts` (env vars) and `src/execution/config.ts` (.kodiai.yml) are separate. Configuration.md should cover .kodiai.yml; env vars are in .env.example.
- **Runbook cross-linking** — docs/README.md must index both the new conceptual docs AND the existing 6 runbooks and 6 smoke test records. Don't orphan them.

## Open Risks

- **Configuration.md completeness** — The 911-line Zod schema has many nested objects. Missing a field would leave a gap. Mitigation: systematically walk every Zod schema export.
- **Architecture accuracy** — 4030-line review.ts has many code paths (incremental review, dep bump, large PR triage, fork handling). Describing flow accurately at the right abstraction level is the challenge. Mitigation: focus on the happy path and list special cases as bullet points.
- **deployment.md drift** — The file was written months ago. Some Azure details may be outdated. Mitigation: quick review against deploy.sh and current env vars.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript/Bun | — | No specialized skill needed (documentation-only slice) |
| Zod | — | No skill needed (reading schema, not building) |

No skill installation recommended — this slice is pure markdown documentation writing with no framework or library dependencies.

## Sources

- `src/index.ts` (774 lines) — Full initialization and wiring graph
- `src/execution/config.ts` (911 lines) — Complete .kodiai.yml Zod schema
- `src/config.ts` (107 lines) — App-level env var config
- `src/handlers/review.ts` (4030 lines) — Review handler flow
- `src/handlers/mention.ts` (2587 lines) — Mention handler flow
- `src/knowledge/retrieval.ts` (867 lines) — Unified retrieval pipeline
- `docs/deployment.md` — Existing deployment docs (moved by S01)
- `docs/runbooks/` — 6 existing operational runbooks
- `.env.example` — 26 documented env vars

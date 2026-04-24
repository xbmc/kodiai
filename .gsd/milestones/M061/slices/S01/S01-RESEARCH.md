# M061/S01 — Research

**Date:** 2026-04-23

## Summary

This slice is a targeted telemetry/reporting repair, not a greenfield observability design. The main runtime already writes execution telemetry to Postgres via `src/telemetry/store.ts`, and LLM-call telemetry is split between `telemetry_events` and `llm_cost_events`. The operator-facing reporting path is the stale part: `scripts/usage-report.ts`, `scripts/phase72-telemetry-follow-through.ts`, `scripts/phase75-live-ops-verification-closure.ts`, and `docs/smoke/phase72-telemetry-follow-through.md` still assume a local SQLite file (`./data/kodiai-telemetry.db`) and old table names like `executions`, even though the production store is Postgres (`telemetry_events`, `rate_limit_events`, `retrieval_quality_events`, `llm_cost_events`).

The deeper gap is attribution, not mere connectivity. Current persisted fields can answer execution-level totals and per-LLM-call totals by `task_type`, but they cannot yet attribute prompt composition by section. `ExecutionResult` only carries aggregate token/cost/cache numbers from the Agent SDK result, and neither `buildMentionContext()` nor `buildReviewPrompt()` emits structured section metrics. S01 therefore needs two linked repairs: (1) repair operator reporting to read Postgres truthfully and separate review/mention/slack/task-type/caching paths, and (2) add stable prompt-section accounting seams so later slices can prove context compaction without eyeballing prompt text.

## Recommendation

Take an additive Postgres-first approach. Do not try to preserve SQLite compatibility in the main reporting path. Follow the existing verifier pattern from `scripts/verify-m044-s01.ts`: explicit preflight for `DATABASE_URL`, fail-open status reporting when DB/Azure evidence is unavailable, and direct use of `createDbClient()` instead of `bun:sqlite`. Keep `TelemetryStore` as the write boundary, because handlers already funnel execution-level telemetry through it and the cost tracker already records per-call facts through `recordLlmCost()`.

For prompt accounting, instrument at prompt-construction seams, not at the executor boundary. `src/execution/mention-context.ts`, `src/execution/mention-prompt.ts`, and `src/execution/review-prompt.ts` already have deterministic section builders and hard caps (`DEFAULT_MAX_CONVERSATION_CHARS`, `DEFAULT_MAX_PR_BODY_CHARS`, `DEFAULT_MAX_CHANGED_FILES`). Add structured prompt metrics near those builders so downstream reporting can attribute token/char growth to named sections. Per AGENTS.md's root-cause-first rule, fix prompt-accounting truth first; otherwise later caching work may optimize around an unmeasured bloated prompt.

## Implementation Landscape

### Key Files

- `src/telemetry/store.ts` — canonical Postgres write path for `telemetry_events`, `rate_limit_events`, `retrieval_quality_events`, `resilience_events`, and `llm_cost_events`. Any new operator-visible accounting fields should be written here or through a sibling store boundary.
- `src/telemetry/types.ts` — current telemetry contract. Today it supports execution totals and LLM-call totals, but nothing for prompt-section attribution. Natural seam for adding prompt metrics or a new record type.
- `src/db/client.ts` — shared `createDbClient()` helper used by modern Postgres-backed scripts. Reporting repair should reuse this instead of opening SQLite directly.
- `src/db/migrations/001-initial-schema.sql` — Postgres schema for `telemetry_events`, `rate_limit_events`, `retrieval_quality_events`, `resilience_events`.
- `src/db/migrations/010-llm-cost-events.sql` — Postgres schema for `llm_cost_events`; already records `task_type`, cache read/write tokens, estimated cost, and provider/model dimensions.
- `src/llm/cost-tracker.ts` — per-invocation LLM cost writer. Good seam for adding durable attribution that belongs to a single model call rather than whole execution telemetry.
- `src/llm/generate.ts` — current aggregation point for AI SDK / Agent SDK call usage. It already computes `totalInput`, `totalOutput`, `totalCacheRead`, `totalCacheCreation` and calls the cost tracker with `taskType` + `deliveryId`.
- `src/execution/agent-entrypoint.ts` — writes `ExecutionResult` from Claude Agent SDK output. It exposes only aggregate usage values today; no prompt breakdown leaves this process.
- `src/execution/types.ts` — `ExecutionResult` contract. If prompt accounting is surfaced through executor output, this type must expand.
- `src/handlers/review.ts` — final review execution telemetry write. Records aggregate execution totals to `telemetry_events`; no prompt-section metrics yet.
- `src/handlers/mention.ts` — final mention execution telemetry write. Uses `taskType: "review.full"` for explicit review requests and `taskType: "mention.response"` for conversational mentions via the execution path, but persisted `telemetry_events` rows only store `eventType`, not `taskType`.
- `src/index.ts` — Slack assistant execution uses `taskType: "slack.response"`; `llm_cost_events` can already distinguish this path even if `telemetry_events` cannot.
- `src/execution/mention-context.ts` — bounded conversational context builder with explicit caps (`DEFAULT_MAX_CONVERSATION_CHARS = 16000`, `DEFAULT_MAX_PR_BODY_CHARS = 1200`) and scale notes. Best seam for measuring thread/PR-body contribution.
- `src/execution/mention-prompt.ts` — wraps mention context and optional PR diff context into the final mention prompt. Good seam for named section accounting on mention flows.
- `src/execution/review-prompt.ts` — major review prompt assembly surface with many explicit section builders (`buildPrIntentScopingSection`, `buildRetrievalContextSection`, `buildLinkedIssuesSection`, `buildPathInstructionsSection`, `buildLargePRTriageSection`, etc.). Best seam for section-by-section accounting and future budget enforcement.
- `scripts/usage-report.ts` — stale operator report. Reads SQLite `./data/kodiai-telemetry.db` directly and queries old `executions` table. This is the clearest repair target.
- `scripts/phase72-telemetry-follow-through.ts` — stale milestone smoke verifier. Hard-coded to SQLite and `executions`; only validates review-side `rate_limit_events`, not current Postgres-backed token accounting.
- `scripts/phase75-live-ops-verification-closure.ts` — same stale SQLite pattern as phase72; likely needs alignment if S01 redefines the proof surface.
- `scripts/verify-m044-s01.ts` — the strongest existing Postgres-backed operator/reporting pattern: DB preflight, `createDbClient()`, fail-open evidence access, and explicit access-state reporting.
- `src/review-audit/evidence-correlation.ts` — shows how current audit/reporting code joins GitHub-visible artifacts with Postgres telemetry truth using `delivery_id` and repo/PR identity.
- `docs/smoke/phase72-telemetry-follow-through.md` — stale documentation still points operators at `./data/kodiai-telemetry.db` and `executions`; must be updated alongside script changes.

### Build Order

1. **Repair the reporting surface first.** Replace SQLite-only reporting (`scripts/usage-report.ts` and any coupled smoke scripts/docs) with Postgres-backed queries using `createDbClient()`. This retires the roadmap’s first unknown immediately: operators can inspect real telemetry instead of a dead path.
2. **Decide the durable attribution shape second.** Choose whether prompt-section accounting belongs as added columns on `llm_cost_events`, a new `prompt_metrics`/`prompt_section_events` table, or executor-emitted JSON that is then persisted. The planner should keep this as an explicit task because current schema does not have a truthful home for per-section data.
3. **Instrument prompt builders third.** Add named section accounting in `mention-context`, `mention-prompt`, and `review-prompt` so later slices can measure prompt compaction by section. Review prompt is the highest-value target because it already has discrete helper functions.
4. **Thread the new metrics through runtime writes last.** Expand executor/handler/store contracts only after the section model is settled. This minimizes churn and keeps verification focused.

### Verification Approach

- Unit/contract tests around any new telemetry record types and store writes in `src/telemetry/store.test.ts`.
- Script-level tests for repaired reporting commands, following the style of `scripts/phase72-telemetry-follow-through.test.ts` / verifier tests, but using Postgres-aware abstractions or injectable query runners rather than `bun:sqlite`.
- Targeted runtime assertions that review, conversational mention, explicit mention-review, and Slack assistant paths can be distinguished from durable data. Today the cleanest durable discriminator is `llm_cost_events.task_type`; `telemetry_events` alone is insufficient for that split.
- Manual smoke command should become `DATABASE_URL`-backed, not file-backed. Reuse `verify-m044-s01.ts` preflight style: report `databaseAccess=available|missing|unavailable` rather than crashing without context.
- Evidence query should prove at least: total tokens/cost by `task_type`, cache read/write totals by task path, and prompt-section rows/fields for a representative `delivery_id` once instrumentation lands.

## Constraints

- `scripts/usage-report.ts`, `scripts/phase72-telemetry-follow-through.ts`, `scripts/phase75-live-ops-verification-closure.ts`, and `docs/smoke/phase72-telemetry-follow-through.md` are all still wired to SQLite paths/tables; changing only one leaves operator truth split.
- `telemetry_events` does **not** currently persist `taskType`; only `llm_cost_events` does. Distinguishing conversational mentions vs explicit review mentions vs Slack is therefore easier from `llm_cost_events` than from `telemetry_events` today.
- `ExecutionResult` and `agent-entrypoint` expose only aggregate usage numbers from SDK model usage. Prompt composition is lost unless S01 adds a new structured path.
- The loaded `REQUIREMENTS.md` excerpt is out of phase with the M061 roadmap: roadmap ownership references R056–R060, but the preloaded active requirements section only lists R061–R076. Planner/executor work should trust the roadmap ownership map for this slice and treat the requirements-file mismatch as a documentation/state risk.

## Common Pitfalls

- **Repairing only the CLI script** — `scripts/usage-report.ts` is stale, but the smoke/verifier scripts and docs are stale in the same way. Leaving them unchanged preserves conflicting operator truth surfaces.
- **Using `telemetry_events` alone for path attribution** — it has `eventType` but not `taskType`, so it cannot cleanly separate conversational mention vs explicit review mention vs Slack assistant.
- **Adding prompt metrics too late in the pipeline** — if instrumentation happens only after executor completion, section-level provenance is already lost.
- **Overloading cache fields semantically** — `telemetry_events.cache_creation_tokens` and `llm_cost_events.cache_write_tokens` are token-cache facts, not prompt-composition facts. Do not repurpose them for section accounting.

## Open Risks

- The slice may need a new telemetry table rather than extending existing ones; current schema is good for execution/cost totals but poor for section attribution.
- Existing milestone smoke scripts are anchored to older SQLite assumptions, so changing proof surfaces may cascade into docs and package script expectations beyond S01’s narrow CLI repair.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Postgres telemetry | `nahisaho/musubi@database-administrator` | available |
| CLI/reporting | `saleor/configurator@implementing-cli-patterns` | available |
| TypeScript/Postgres runtime | installed skills list did not include a directly relevant telemetry/Postgres skill | none found |

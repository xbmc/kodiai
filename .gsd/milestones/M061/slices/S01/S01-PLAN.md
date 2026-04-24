# S01: Token Accounting Baseline and Reporting Repair

**Goal:** Repair operator token-reporting so it reads the live Postgres telemetry schema, add durable prompt-section accounting for mention/review/slack executions, and ship a baseline verifier/report surface that can attribute token spend and cache behavior before later optimization slices change prompt assembly.
**Demo:** operators can inspect real Postgres-backed token, prompt-composition, and cache-effectiveness evidence for mention/review executions instead of relying on stale or incomplete usage reporting.

## Must-Haves

- ## Demo
- Operators can run a Postgres-backed reporting/verifier flow and inspect real token, cache, task-type, and prompt-section evidence for representative `review.full`, `mention.response`, and `slack.response` executions without touching the stale SQLite path.
- ## Must-Haves
- Replace stale SQLite-only usage/smoke reporting with Postgres-backed scripts that read current telemetry tables through the shared DB client and fail open when live access is unavailable.
- Persist durable task-path and prompt-section accounting so later slices can measure prompt compaction by named section instead of eyeballing raw prompt text.
- Capture section metrics at prompt-construction seams for mention and review flows, then thread them through the runtime telemetry write path with tests.
- Produce a rerunnable baseline verifier/report surface that proves token totals, cache effectiveness, and prompt-section attribution for mention/review/slack paths using the live schema.
- ## Verification
- `src/telemetry/store.test.ts`
- `src/execution/mention-context.test.ts`
- `src/execution/mention-prompt.test.ts`
- `src/execution/review-prompt.test.ts`
- `scripts/usage-report.test.ts`
- `scripts/phase72-telemetry-follow-through.test.ts`
- `scripts/phase75-live-ops-verification-closure.test.ts`
- `bun test src/telemetry/store.test.ts src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts`
- `bun run lint`
- ## Threat Surface
- **Abuse**: Operator-facing scripts now query live telemetry; malformed CLI filters or misleading fallback behavior could hide missing evidence or misclassify task paths.
- **Data exposure**: Telemetry rows can contain repo identity, delivery IDs, token/cost totals, and prompt-section sizes; reports must not emit secrets or raw prompt bodies.
- **Input trust**: Untrusted inputs are CLI args (`--repo`, `--since`, JSON flags) and persisted telemetry fields read from Postgres; reporting must validate and render them safely.
- ## Requirement Impact
- **Requirements touched**: R056, R057, R058, R059, R060 (roadmap ownership map; active requirements file is out of sync for this milestone).
- **Re-verify**: Mention/review/slack telemetry writes, prompt-builder accounting seams, operator report/verifier output, and fail-open access-state reporting.
- **Decisions revisited**: D175.
- ## Proof Level
- This slice proves: operational
- Real runtime required: yes
- Human/UAT required: no

## Proof Level

- This slice proves: Operational proof against the live Postgres telemetry schema plus contract tests for prompt-section accounting. The slice is only done when reporting/verifier surfaces can attribute token and cache behavior by task path and expose prompt-section metrics without relying on the removed SQLite assumptions.

## Integration Closure

Consumes the existing prompt builders, LLM cost tracker, telemetry store, Postgres schema/client, and operator smoke/verifier scripts. This slice must wire prompt-section metrics from builder seams into durable telemetry and then into operator-facing scripts/docs; downstream milestone slices can assume the reporting seam exists and do not need to rediscover storage or access patterns.

## Verification

- Adds operator-visible attribution surfaces over `telemetry_events`/`llm_cost_events` and the new prompt-section persistence path, with fail-open DB access reporting and named prompt sections so future agents can diagnose prompt bloat, cache effectiveness, and missing telemetry without reading raw prompts.

## Tasks

- [x] **T01: Define durable prompt-accounting storage and telemetry contracts** `est:1.5h`
  Add the durable schema, TypeScript contracts, and store coverage needed to persist task-path attribution and prompt-section metrics alongside existing execution/LLM cost events. This closes the highest-risk unknown first: later work cannot report prompt composition truthfully until there is a stable storage shape and tested write boundary.

Assumption to document in code/tests: prompt-section accounting records sizes/estimated tokens by named section and delivery/task path, but never stores raw prompt text.
  - Files: `src/telemetry/types.ts`, `src/telemetry/store.ts`, `src/telemetry/store.test.ts`, `src/db/migrations/011-prompt-section-events.sql`, `src/llm/cost-tracker.ts`, `src/llm/generate.ts`, `src/execution/types.ts`
  - Verify: bun test src/telemetry/store.test.ts

- [x] **T02: Instrument mention and review prompt builders with named section metrics** `est:2h`
  Capture prompt-section accounting at the actual mention/review construction seams, then thread the resulting metrics into the execution/runtime path. The instrumentation must stay deterministic, bounded, and text-free so later slices can compare prompt size by section without storing prompt bodies.

Note for executors: cover both conversational mention context and the large review prompt builder sections because S02 and S03 depend on these seams.
  - Files: `src/execution/mention-context.ts`, `src/execution/mention-prompt.ts`, `src/execution/review-prompt.ts`, `src/execution/mention-context.test.ts`, `src/execution/mention-prompt.test.ts`, `src/execution/review-prompt.test.ts`, `src/execution/agent-entrypoint.ts`, `src/handlers/mention.ts`, `src/handlers/review.ts`
  - Verify: bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts

- [ ] **T03: Replace stale SQLite reporting with Postgres-backed operator surfaces** `est:2h`
  Rebuild the operator-facing usage and smoke reporting path on top of `createDbClient()` and the live Postgres telemetry tables. This task must remove the stale `executions`/SQLite assumptions from the main CLI and update the deterministic verifier fixtures/tests to the current schema while preserving fail-open preflight messaging.

Keep the reporting surface focused on truthful attribution: token totals, cost totals, cache effectiveness, task-path separation, and prompt-section summaries by delivery/task type.
  - Files: `scripts/usage-report.ts`, `scripts/usage-report.test.ts`, `scripts/phase72-telemetry-follow-through.ts`, `scripts/phase72-telemetry-follow-through.test.ts`, `scripts/phase75-live-ops-verification-closure.ts`, `scripts/phase75-live-ops-verification-closure.test.ts`, `src/db/client.ts`
  - Verify: bun test scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts

- [ ] **T04: Publish the baseline proof and operator runbook updates** `est:1h`
  Finish the slice by documenting and verifying the repaired reporting path. Update smoke/runbook docs to the new Postgres-backed commands, add a dedicated baseline proof command if the existing scripts are not sufficient, and ensure the slice-level verification exercises mention/review/slack path attribution plus prompt-section visibility.

This task closes the integration loop so downstream slices can consume a stable baseline evidence surface instead of reverse-engineering scripts or schema changes.
  - Files: `docs/smoke/phase72-telemetry-follow-through.md`, `docs/smoke/phase75-live-ops-verification-closure.md`, `docs/runbooks/review-requested-debug.md`, `package.json`, `scripts/verify-m061-s01.ts`
  - Verify: bun test src/telemetry/store.test.ts src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts && bun run lint

## Files Likely Touched

- src/telemetry/types.ts
- src/telemetry/store.ts
- src/telemetry/store.test.ts
- src/db/migrations/011-prompt-section-events.sql
- src/llm/cost-tracker.ts
- src/llm/generate.ts
- src/execution/types.ts
- src/execution/mention-context.ts
- src/execution/mention-prompt.ts
- src/execution/review-prompt.ts
- src/execution/mention-context.test.ts
- src/execution/mention-prompt.test.ts
- src/execution/review-prompt.test.ts
- src/execution/agent-entrypoint.ts
- src/handlers/mention.ts
- src/handlers/review.ts
- scripts/usage-report.ts
- scripts/usage-report.test.ts
- scripts/phase72-telemetry-follow-through.ts
- scripts/phase72-telemetry-follow-through.test.ts
- scripts/phase75-live-ops-verification-closure.ts
- scripts/phase75-live-ops-verification-closure.test.ts
- src/db/client.ts
- docs/smoke/phase72-telemetry-follow-through.md
- docs/smoke/phase75-live-ops-verification-closure.md
- docs/runbooks/review-requested-debug.md
- package.json
- scripts/verify-m061-s01.ts

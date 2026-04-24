---
id: T01
parent: S01
milestone: M061
key_files:
  - src/db/migrations/038-prompt-section-events.sql
  - src/db/migrations/038-prompt-section-events.down.sql
  - src/telemetry/types.ts
  - src/telemetry/store.ts
  - src/telemetry/store.test.ts
  - src/llm/cost-tracker.ts
  - src/llm/generate.ts
  - src/execution/types.ts
key_decisions:
  - Persist prompt-section accounting in a dedicated `prompt_section_events` table keyed by delivery/task/prompt path instead of storing raw prompt text or embedding opaque JSON in existing cost rows.
  - Make prompt-section telemetry a forward-compatible runtime contract by adding optional prompt-section records to the LLM generation seam before later slices instrument real mention/review/slack prompt builders.
duration: 
verification_result: passed
completed_at: 2026-04-24T00:27:46.309Z
blocker_discovered: false
---

# T01: Added durable prompt-section telemetry storage, contracts, and store coverage for task-path attribution without persisting raw prompt text.

**Added durable prompt-section telemetry storage, contracts, and store coverage for task-path attribution without persisting raw prompt text.**

## What Happened

I added a new Postgres migration pair at `src/db/migrations/038-prompt-section-events.{sql,down.sql}` because the planned `011-*` filename was stale against local reality and already occupied by unrelated migrations. The new table stores delivery/task/prompt-path attribution plus ordered section metrics (`section_name`, `section_position`, `char_count`, `estimated_tokens`, `truncated`) and intentionally excludes raw prompt bodies.

In `src/telemetry/types.ts` and `src/telemetry/store.ts`, I introduced text-free `PromptSectionMetric`/`PromptSectionRecord` contracts plus a canonical `recordPromptSections()` store method. The store now persists prompt-section rows with upsert behavior on delivery/task/prompt path identity and purges them alongside the existing telemetry tables.

In `src/llm/cost-tracker.ts`, `src/llm/generate.ts`, and `src/execution/types.ts`, I added forward-compatible seams so later tasks can thread real prompt-section accounting through the LLM runtime path without redesigning the contracts again. `generateWithFallback()` now accepts optional prompt-section records and sends them through the telemetry write boundary before invocation when supplied.

In `src/telemetry/store.test.ts`, I expanded the store coverage to include prompt-section persistence, text-free schema assertions, task-path LLM cost persistence, and truncation cleanup for the new tables. The tests also document the milestone assumption that section accounting stores only named-section size estimates and never raw prompt text.

## Verification

Ran `bun test src/telemetry/store.test.ts`. The suite exited successfully and compiled the updated telemetry/store contracts. In this environment the database-backed cases were skipped because `TEST_DATABASE_URL` was not set, so the verification proves the store test file remains loadable and the new contracts do not break the targeted test entrypoint, but it does not exercise live Postgres writes here.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/telemetry/store.test.ts` | 0 | ✅ pass | 109ms |

## Deviations

Used `src/db/migrations/038-prompt-section-events.sql` instead of the planned `011-prompt-section-events.sql` because migration 011 already exists in the current repository. This was a local filename correction only; the storage shape and scope stayed aligned with the task contract.

## Known Issues

Database-backed telemetry assertions remain environment-gated by `TEST_DATABASE_URL`, so the new prompt-section insert/upsert behavior was not exercised against a live Postgres instance in this run.

## Files Created/Modified

- `src/db/migrations/038-prompt-section-events.sql`
- `src/db/migrations/038-prompt-section-events.down.sql`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/telemetry/store.test.ts`
- `src/llm/cost-tracker.ts`
- `src/llm/generate.ts`
- `src/execution/types.ts`

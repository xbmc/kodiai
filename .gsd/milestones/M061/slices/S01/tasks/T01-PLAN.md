---
estimated_steps: 2
estimated_files: 7
skills_used: []
---

# T01: Define durable prompt-accounting storage and telemetry contracts

Add the durable schema, TypeScript contracts, and store coverage needed to persist task-path attribution and prompt-section metrics alongside existing execution/LLM cost events. This closes the highest-risk unknown first: later work cannot report prompt composition truthfully until there is a stable storage shape and tested write boundary.

Assumption to document in code/tests: prompt-section accounting records sizes/estimated tokens by named section and delivery/task path, but never stores raw prompt text.

## Inputs

- ``src/telemetry/types.ts``
- ``src/telemetry/store.ts``
- ``src/telemetry/store.test.ts``
- ``src/db/migrations/010-llm-cost-events.sql``
- ``src/llm/cost-tracker.ts``
- ``src/llm/generate.ts``
- ``src/execution/types.ts``

## Expected Output

- ``src/db/migrations/011-prompt-section-events.sql``
- ``src/telemetry/types.ts``
- ``src/telemetry/store.ts``
- ``src/telemetry/store.test.ts``
- ``src/llm/cost-tracker.ts``
- ``src/llm/generate.ts``
- ``src/execution/types.ts``

## Verification

bun test src/telemetry/store.test.ts

## Observability Impact

Creates the durable prompt-accounting event shape and tests the canonical store write path so later scripts can inspect attribution from Postgres rather than ad hoc in-memory summaries.

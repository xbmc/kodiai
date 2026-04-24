# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks in isolated Azure Container App jobs. The current planning focus is Milestone M061, which is reducing prompt/context spend only after establishing truthful Postgres-backed telemetry and proof surfaces.

## Core Value

High-signal, truthful automated review on every PR. The current optimization track extends that value with operator-visible evidence so prompt and retrieval reductions can be measured against real token, cache, and prompt-section data instead of stale or incomplete reporting.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing. Large-PR redesign work through M052–M055 is already in place, including bounded first-pass review, automatic continuation, stable public review identity, supersession handling, and live lifecycle proof surfaces.

Milestone M061 is the active optimization track:
- S01 is complete and established the repaired Postgres-backed reporting baseline, durable prompt-section telemetry, and slice-level verification for `review.full`, `mention.response`, and `slack.response`.
- S02 is complete and stages heavy mention context only when request shape warrants it, preserving the rich explicit-review path while shrinking ordinary conversational mention inputs by default.
- S03 is complete and compacts review prompt assembly into bounded named sections, preserves the unified knowledge-context preference, threads multi-section `review.user-prompt` telemetry through initial and retry review flows, and adds an operator verifier for section budgets and truncation visibility with fail-open Postgres handling.
- S04 will add retrieval reuse and safe derived-context caching on top of the staged mention/review context policies.
- S05 will provide the integrated token-reduction proof and regression gate across representative mention/review flows.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Review identity:** `reviewOutputKey` plus HTML markers create a stable visible review identity across GitHub surfaces.
- **Telemetry baseline:** Usage and verifier scripts read live Postgres telemetry via `createDbClient()` and fail open with explicit database access states instead of consulting stale SQLite paths.
- **Prompt accounting:** Mention and review builders emit text-free named prompt-section metrics that are persisted in `prompt_section_events` and threaded through local plus Agent SDK execution seams.
- **Mention context diet:** Mention handling now derives a shared admission policy from request shape and reuses it across prompt context admission, candidate code-pointer fetches, PR diff prefetch, and retrieval shaping so conversational reductions are real rather than cosmetic.
- **Review prompt compaction:** Review prompt assembly now preserves the existing `review.user-prompt` contract while emitting budgeted named sections for change context, size/boundedness context, graph evidence, knowledge context, and instruction-heavy guidance, with section-level truncation surfaced through canonical reporting.
- **Optimization direction:** Remaining M061 slices build on the truthful evidence seams from S01–S03 rather than adding parallel measurement systems.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M052: Large-PR truth baseline — define and prove the bounded first-pass contract, coverage accounting, and visible review state.
- [x] M053: Continuation-driven review execution — add automatic continuation and evolve one stable public review surface in place.
- [x] M054: Continuation state, supersession, and operator evidence — make the lifecycle durable, supersession-safe, and diagnosable.
- [x] M055: Live hardening and rollout proof — prove the redesigned lifecycle on real large PRs without regressing normal review behavior.
- [ ] M061: Token accounting baseline and reduction proof — S01/S02/S03 complete; retrieval reuse and integrated proof remain in S04–S05.

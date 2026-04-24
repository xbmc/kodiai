# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks in isolated Azure Container App jobs. The current planning focus is Milestone M061, which establishes a truthful Postgres-backed token-accounting baseline for mention, review, and Slack executions before prompt-diet and caching reductions land in later slices.

## Core Value

High-signal, truthful automated review on every PR. The current optimization track extends that value with operator-visible telemetry: later prompt-reduction work must be measured against real token, cache, and prompt-section evidence rather than stale or incomplete reporting.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing. Large-PR redesign work through M052–M055 is already in place, including bounded first-pass review, automatic continuation, stable public review identity, supersession handling, and live lifecycle proof surfaces.

Milestone M061 is now the active optimization track:
- S01 establishes the repaired Postgres-backed reporting baseline, durable prompt-section telemetry, and a slice-level verifier for review.full, mention.response, and slack.response.
- S02 reduces mention-flow context by staging expensive context only when request shape needs it.
- S03 compacts review prompt assembly under explicit per-section budgets.
- S04 adds retrieval reuse and safe derived-context caching.
- S05 proves integrated token reduction and adds a regression gate.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Review identity:** `reviewOutputKey` plus HTML markers create a stable visible review identity across GitHub surfaces.
- **Telemetry baseline:** Usage and verifier scripts read live Postgres telemetry via `createDbClient()` and fail open with explicit database access states instead of consulting stale SQLite paths.
- **Prompt accounting:** Mention and review builders emit text-free named prompt-section metrics that are persisted in `prompt_section_events` and threaded through local plus Agent SDK execution seams.
- **Optimization direction:** Future token-reduction slices rely on durable task-path attribution, prompt-section summaries, delivery breakdowns, and cache-effectiveness evidence established in M061/S01.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M052: Large-PR truth baseline — define and prove the bounded first-pass contract, coverage accounting, and visible review state.
- [x] M053: Continuation-driven review execution — add automatic continuation and evolve one stable public review surface in place.
- [x] M054: Continuation state, supersession, and operator evidence — make the lifecycle durable, supersession-safe, and diagnosable.
- [x] M055: Live hardening and rollout proof — prove the redesigned lifecycle on real large PRs without regressing normal review behavior.
- [ ] M061: Token accounting baseline and reduction proof — repair telemetry truth surfaces first, then reduce prompt/context spend with measurable evidence.

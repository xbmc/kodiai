# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks in isolated Azure Container App jobs. The current planning focus is a large-PR review redesign so Kodiai can produce a truthful bounded first review, continue automatically in the background, and evolve one stable public review surface instead of dying at `max_turns`.

## Core Value

High-signal, truthful automated review on every PR. For large PRs, that value anchor becomes: return useful review output quickly, disclose real coverage, and keep deepening review without turning the PR into a noisy comment stream.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing. The current system already has large-PR triage, timeout-risk estimation, bounded review disclosure, and review publication identity via `reviewOutputKey`, but large PRs can still exhaust `max_turns` and end the review lifecycle too early.

This planning pass scopes a redesign track across M052–M055:
- M052 defines the truthful bounded first-pass contract and coverage/state rendering.
- M053 redesigns execution around automatic continuation and one evolving review surface.
- M054 hardens continuation state, supersession, and operator evidence.
- M055 proves the lifecycle on live large PRs and locks the rollout contract.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Review identity:** `reviewOutputKey` plus HTML markers create a stable visible review identity across GitHub surfaces.
- **Bounded large-PR behavior today:** `src/handlers/review.ts` already performs large-PR triage, timeout-risk estimation, dynamic timeout scaling, scope reduction, and bounded-review disclosure.
- **Publication/state today:** review publication already has append/upsert behavior, publish-rights checks, and supersession handling.
- **Planned redesign direction:** preserve one stable public review surface, let large-PR review deepen automatically in the background, and keep finding revisions explicit rather than silent.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M052: Large-PR truth baseline — define and prove the bounded first-pass contract, coverage accounting, and visible review state.
- [ ] M053: Continuation-driven review execution — add automatic continuation and evolve one stable public review surface in place.
- [ ] M054: Continuation state, supersession, and operator evidence — make the lifecycle durable, supersession-safe, and diagnosable.
- [ ] M055: Live hardening and rollout proof — prove the redesigned lifecycle on real large PRs without regressing normal review behavior.

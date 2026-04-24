# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks in isolated Azure Container App jobs.

## Core Value

High-signal, truthful automated review on every PR. The current roadmap focus is making large-PR review behavior honest and verifiable so constrained runs publish useful first-pass output instead of dying in a misleading failure state.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestone M062 is the active baseline track for large-PR truthfulness:
- S01 is complete and establishes a normalized bounded first-pass contract for constrained large-PR reviews.
- Constrained timeout, `max_turns`, and large-PR outcomes now normalize through one structured payload that records bounded reason, evidence source, covered scope, remaining scope, publication eligibility, and continuation state.
- `src/handlers/review.ts`, partial-review formatting, and Review Details now consume the same first-pass state, so visible coverage and bounded-reason wording stay aligned.
- `verify:m062:s01` is now the deterministic proof surface for distinguishing publishable bounded first-pass output from zero-evidence dead-end failure.
- S02 remains focused on refining coherent visible coverage/state rendering on top of this shared contract.
- S03 remains focused on the larger milestone proof harness that composes the S01/S02 contracts into a stable operator baseline.

The prior token-accounting track (M061) established Postgres-backed telemetry, prompt-section accounting, mention-context reduction, and reuse evidence that now remain as supporting infrastructure rather than the active planning focus.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Review identity:** `reviewOutputKey` plus HTML markers create a stable visible review identity across GitHub surfaces.
- **Large-PR first-pass contract:** `normalizeReviewFirstPass` is the single structured seam for constrained review outcomes. It prefers checkpoint evidence over inferred counts, omits unsupported scope fields, and preserves an explicit `zero-evidence-failure` state when no truthful first-pass evidence exists.
- **Visible review coherence:** Partial-review output and Review Details both derive bounded reason, evidence source, and covered/remaining scope from the same normalized first-pass payload.
- **Deterministic proof:** `scripts/verify-m062-s01.ts` reuses the production first-pass normalization seam and validates bounded-vs-dead-end classification with stable scenario fixtures and `reviewOutputKey`-anchored outputs.
- **Telemetry baseline:** Usage and verifier scripts read live Postgres telemetry via `createDbClient()` and fail open with explicit database access states instead of consulting stale SQLite paths.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M052: Large-PR truth baseline foundations and lifecycle constraints.
- [x] M053: Continuation-driven review execution.
- [x] M054: Continuation state, supersession, and operator evidence.
- [x] M055: Live hardening and rollout proof.
- [x] M061: Token-accounting baseline and reduction proof track (supporting observability infrastructure).
- [ ] M062: Large-PR truth baseline — S01 complete; S02 and S03 remain.

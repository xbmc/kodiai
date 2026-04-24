# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks in isolated Azure Container App jobs.

## Core Value

High-signal, truthful automated review on every PR. The current roadmap focus is continuation-aware large-PR review: the first pass must be useful and honest, and later passes must deepen coverage without rewriting history silently.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestone M062 is complete as the large-PR truth baseline:
- S01 established `normalizeReviewFirstPass`, the single normalized bounded first-pass contract for constrained large-PR reviews.
- S02 unified the visible bounded-review contract across the public partial comment and Review Details so both surfaces report the same covered scope, remaining scope, bounded reason, and continuation state.
- S03 added `verify:m062:s03`, a deterministic milestone verifier that runs the S01 scenario matrix through the production bounded-comment and Review Details renderers and proves semantic parity plus explicit zero-evidence rejection.
- Timeout partial publication, retry-merged updates, and bounded `max_turns` fallback now all publish through the same shared formatter contract instead of branch-local prose.
- Requirements `R061` and `R064` are validated with fresh milestone-close evidence from verifier tests, handler/formatter tests, deterministic verifier runs, and a clean TypeScript compile gate.
- M062 now has two deterministic proof surfaces: `verify:m062:s01` for bounded-vs-dead-end first-pass classification and `verify:m062:s03` for visible-surface truthfulness parity.

The next roadmap focus is M063 continuation redesign: automatic background continuation, in-place visible review updates, and explicit revision semantics on the same review lifecycle.

The prior token-accounting track (M061) remains supporting infrastructure: Postgres-backed telemetry, prompt-section accounting, mention-context reduction, and reuse evidence continue to provide observability and verification surfaces for later review-work milestones.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Review identity:** `reviewOutputKey` plus HTML markers create a stable visible review identity across GitHub surfaces.
- **Large-PR first-pass contract:** `normalizeReviewFirstPass` is the single structured seam for constrained review outcomes. It prefers checkpoint evidence over inferred counts, omits unsupported scope fields, and preserves an explicit `zero-evidence-failure` state when no truthful first-pass evidence exists.
- **Visible review coherence:** Partial-review output and Review Details both derive bounded reason, evidence source, covered scope, remaining scope, and continuation state from the same normalized first-pass payload; timeout/retry data is additive metadata rather than an alternate wording path.
- **Deterministic proof:** `scripts/verify-m062-s01.ts` validates bounded-vs-dead-end classification from the production first-pass seam, and `scripts/verify-m062-s03.ts` validates that the bounded public comment and Review Details stay semantically aligned on the same scenarios.
- **Telemetry baseline:** Usage and verifier scripts read live Postgres telemetry via `createDbClient()` and fail open with explicit database access states instead of consulting stale SQLite paths.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M052: Large-PR truth baseline foundations and lifecycle constraints.
- [x] M053: Continuation-driven review execution.
- [x] M054: Continuation state, supersession, and operator evidence.
- [x] M055: Live hardening and rollout proof.
- [x] M061: Token-accounting baseline and reduction proof track (supporting observability infrastructure).
- [x] M062: Large-PR truth baseline — bounded first-pass contract, visible review coherence, and deterministic truthfulness verifier complete.

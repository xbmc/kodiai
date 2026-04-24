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

Milestone M063 is in progress on continuation redesign:
- S01 is complete: large-PR bounded first passes now plan automatic continuation through a dedicated lifecycle seam instead of timeout-branch-local handler logic.
- S02 is complete: continuation now deepens one canonical visible review surface anchored to the base `reviewOutputKey`, refreshes nested Review Details in place, renders explicit revision summaries when findings change, and keeps no-delta settlement publicly quiet.
- `src/lib/review-continuation-lifecycle.ts` owns continuation planning and settlement decisions, keeping the base `reviewOutputKey` as the public lifecycle identity while deriving continuation passes with a stable `-retry-1` suffix.
- `src/handlers/review.ts` now orchestrates automatic enqueue, same-surface merge/no-delta settlement, and stale-authority suppression through that shared lifecycle contract and the existing `ReviewWorkCoordinator` checks.
- `scripts/verify-m063-s01.ts` proves automatic continuation scheduling, settlement classification, and stale-authority suppression; `scripts/verify-m063-s02.ts` proves same-surface ownership, explicit revision visibility, and quiet no-delta settlement.
- Requirements `R062`, `R063`, and `R065` are now validated on shipped paths. S03 remains to prove prompt/context narrowing and end-state authority safety across the final continuation write paths.

The prior token-accounting track (M061) remains supporting infrastructure: Postgres-backed telemetry, prompt-section accounting, mention-context reduction, and reuse evidence continue to provide observability and verification surfaces for later review-work milestones.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Review identity:** `reviewOutputKey` plus HTML markers create a stable visible review identity across GitHub surfaces.
- **Large-PR first-pass contract:** `normalizeReviewFirstPass` is the single structured seam for constrained review outcomes. It prefers checkpoint evidence over inferred counts, omits unsupported scope fields, and preserves an explicit `zero-evidence-failure` state when no truthful first-pass evidence exists.
- **Continuation lifecycle seam:** automatic large-PR follow-up is driven by `planReviewContinuation(...)` and `settleReviewContinuation(...)`, which separate scheduling/settlement rules from handler orchestration and keep continuation pass keys distinct from the public lifecycle key.
- **Canonical continuation surface:** the bounded first-pass comment is the only public lifecycle surface for continuation. It carries the base `reviewOutputKey` marker, owns the nested Review Details block, and is refreshed in place by timeout and retry merge paths.
- **Revision visibility contract:** continuation merges classify deltas against prior findings and render explicit revision summaries for new, still-open, and resolved findings. All-zero deltas settle quietly without public comment churn.
- **Deterministic proof:** `scripts/verify-m062-s01.ts` validates bounded-vs-dead-end classification from the production first-pass seam, `scripts/verify-m062-s03.ts` validates visible-surface semantic alignment, `scripts/verify-m063-s01.ts` validates automatic continuation scheduling/settlement/authority suppression, and `scripts/verify-m063-s02.ts` validates same-surface ownership and revision/no-delta behavior.
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
- [ ] M063: Continuation redesign — S01 automatic lifecycle and S02 same-surface revision semantics complete; S03 bounded continuation shaping and authority-safe proof remain.

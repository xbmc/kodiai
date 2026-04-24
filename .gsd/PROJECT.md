# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks in isolated Azure Container App jobs.

## Core Value

High-signal, truthful automated review on every PR. The current roadmap focus is continuation-aware large-PR review: the first pass must be useful and honest, and later passes must deepen coverage without rewriting history silently.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestone M064 is in progress on continuation authority hardening:
- S01 is complete and establishes `continuation_family_state` as the durable canonical continuation-family truth surface keyed by `(familyKey, baseReviewOutputKey)`.
- S02 is now complete and projects the live timeout/retry orchestration path into canonical continuation-family state.
- `save_review_checkpoint` now reports success only after `knowledgeStore.saveCheckpoint(...)` resolves; rejected writes return the existing error path instead of optimistic `saved: true`.
- `src/handlers/review.ts` now finalizes retry enqueue failure, retry execution failure, telemetry projection degradation, and stale retry supersession through canonical continuation-family state, preserving ordinal-guarded authority semantics.
- `scripts/verify-m064-s02.ts` is the deterministic proof surface for retry enqueue failure, retry execution failure, telemetry projection degradation, and superseded stale retry scenarios; it answers directly from canonical durable state instead of checkpoint JSON or telemetry rows.
- Requirement `R075` is validated from fresh slice-close evidence. `R074` remains active for S03, which still needs to make operator-facing report/projection surfaces canonical-state-first.
- S03 remains to finish canonical-state-first operator evidence/reporting and expose degraded projection status directly in report output.

Milestone M063 is complete as the continuation-driven large-PR execution redesign:
- S01 established automatic continuation planning and settlement through `src/lib/review-continuation-lifecycle.ts`, removing timeout-branch-local continuation behavior.
- S02 collapsed continuation onto one canonical visible review surface anchored to the base `reviewOutputKey`, refreshed nested Review Details in place, rendered explicit revision summaries, and kept no-delta settlement publicly quiet.
- S03 added deterministic proof that continuation stays materially narrower than the first pass and remains authority-safe on shipped same-surface retry paths.
- `scripts/verify-m063-s01.ts` proves automatic continuation scheduling, settlement classification, and stale-authority suppression.
- `scripts/verify-m063-s02.ts` proves same-surface ownership, explicit revision visibility, and quiet no-delta settlement.
- `scripts/verify-m063-s03.ts` proves continuation narrows `review-change-context`, omits first-pass-only `review-size-context`, preserves required prompt sections, and stays truthful about sufficient-but-bounded coverage rather than claiming exhaustive review.
- `src/handlers/review.test.ts` now proves stale/superseded retry attempts cannot overwrite the canonical summary, cannot refresh nested Review Details after losing publish rights, and keep no-delta settlement as a public no-op.
- Requirements `R062`, `R063`, `R065`, and `R066` are validated, and milestone-close verification re-ran `scripts/verify-m063-s01.ts --json`, `bun run verify:m063:s02 -- --json`, `bun run verify:m063:s03 -- --json`, and `bun run tsc --noEmit` successfully.

The prior token-accounting track (M061) remains supporting infrastructure: Postgres-backed telemetry, prompt-section accounting, mention-context reduction, and reuse evidence continue to provide observability and verification surfaces for later review-work milestones.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Review identity:** `reviewOutputKey` plus HTML markers create a stable visible review identity across GitHub surfaces.
- **Large-PR first-pass contract:** `normalizeReviewFirstPass` is the single structured seam for constrained review outcomes. It prefers checkpoint evidence over inferred counts, omits unsupported scope fields, and preserves an explicit `zero-evidence-failure` state when no truthful first-pass evidence exists.
- **Continuation lifecycle seam:** automatic large-PR follow-up is driven by `planReviewContinuation(...)` and `settleReviewContinuation(...)`, which separate scheduling/settlement rules from handler orchestration and keep continuation pass keys distinct from the public lifecycle key.
- **Canonical continuation surface:** the bounded first-pass comment is the only public lifecycle surface for continuation. It carries the base `reviewOutputKey` marker, owns the nested Review Details block, and is refreshed in place by timeout and retry merge paths.
- **Canonical continuation-family state:** `continuation_family_state` is the durable authority layer for operator truth. One canonical row per `(familyKey, baseReviewOutputKey)` records authoritative attempt identity, authoritative outcome, final stop reason, projection status, and supersession metadata; ordinal-guarded upserts prevent stale attempts from reclaiming authority.
- **Truthful checkpoint acknowledgement:** MCP checkpoint persistence only reports `saved: true` after the underlying durable write resolves; failures stay on the error path instead of fabricating evidence durability.
- **Failure-path canonicalization:** retry enqueue failure, retry execution failure, telemetry projection degradation, and stale supersession are all projected into canonical continuation-family state rather than left implicit in logs or transient coordinator state.
- **Deterministic proof:** `scripts/verify-m062-s01.ts` validates bounded-vs-dead-end classification from the production first-pass seam, `scripts/verify-m062-s03.ts` validates visible-surface semantic alignment, `scripts/verify-m063-s01.ts` validates automatic continuation scheduling/settlement/authority suppression, `scripts/verify-m063-s02.ts` validates same-surface ownership and revision/no-delta behavior, `scripts/verify-m063-s03.ts` validates bounded continuation shaping and truthful authority-safe completion, `scripts/verify-m064-s01.ts` validates canonical continuation-family authority and stop-reason answers directly from durable state, and `scripts/verify-m064-s02.ts` validates orchestration failure/supersession truth from the same canonical source.
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
- [x] M063: Continuation redesign — automatic continuation lifecycle, canonical same-surface revisions, bounded continuation proof, and stale-authority safety complete.
- [ ] M064: Continuation state, supersession, and operator evidence — S01-S02 complete; S03 remains.

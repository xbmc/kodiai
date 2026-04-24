# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks in isolated Azure Container App jobs.

## Core Value

High-signal, truthful automated review on every PR. The current roadmap focus is continuation-aware large-PR review: the first pass must be useful and honest, and later passes must deepen coverage without rewriting history silently.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestone M065 is now code-complete for the rollout-proof surface:
- S01 is complete. `scripts/verify-m065.ts` composes the authoritative `verify:m062:s03`, `verify:m063:s03`, and `verify:m064:s03` reports into one milestone-level proof surface without flattening nested evidence.
- S02 is complete in code. `scripts/verify-m065-s02.ts` provides the dedicated live-proof verifier anchored on a `reviewOutputKey`, with repo/delivery cross-checks, stable check ids, preserved nested `verify:m048:s01` / `verify:m049:s02` / `verify:m064:s03` reports, identity correlation, and representative-bundle sufficiency checks.
- S03 is complete. `scripts/verify-m065-s03.ts` wraps fresh `verify:m061:regression` evidence under `nested_reports.regression_gate`, validates rollout runbook/package command wiring, and exposes stable drill-down/report-key surfaces for operator reruns. `scripts/verify-m065.ts` now projects `M065-FRESH-REGRESSION-PROOF` from authoritative `nested_reports.s03` data instead of a placeholder.
- `scripts/verify-m064-s03.ts` now uses fixture-backed operator evidence only for fixture keys and degrades live operator lookup to a structured `lookup-unavailable` record instead of crashing when the canonical continuation store is unreachable.
- In the current unattended environment, `bun run verify:m065 -- --json` still fails truthfully on the separate S02 live large-PR obligation. The remaining blocker is live evidence availability, not milestone-close packaging: representative sample keys still report missing phase-timing rows, GitHub-visible artifact gaps or GitHub API denial, and unavailable canonical operator truth when live storage cannot be reached.

Milestone M064 is complete as the continuation authority hardening track:
- S01 established `continuation_family_state` as the durable canonical continuation-family truth surface keyed by `(familyKey, baseReviewOutputKey)` and proved canonical answers for merged, quiet-settled, blocked, and superseded scenarios.
- S02 projected the live timeout/retry orchestration path into canonical continuation-family state, hardened stale-attempt shielding, and made checkpoint durability acknowledgements truthful by awaiting durable save completion.
- S03 added the canonical-state-first operator evidence seam in `src/knowledge/continuation-operator-evidence.ts`, so operators can start from a `reviewOutputKey`-shaped identifier and resolve one authoritative continuation-family record without reconstructing DB keys or correlating logs.
- `scripts/verify-m064-s01.ts`, `scripts/verify-m064-s02.ts`, and `scripts/verify-m064-s03.ts` now form the deterministic proof chain for canonical lifecycle truth, runtime failure/supersession truth, and operator-facing continuation evidence.
- Requirements `R067`, `R071`, `R072`, `R073`, `R074`, and `R075` are validated from fresh milestone-close evidence.

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
- **Canonical-state-first operator evidence:** `reviewOutputKey`-driven operator lookup resolves identity through the existing `parseReviewOutputKey()` + family-key contract and projects a shared report object that preserves canonical fields verbatim. Human and JSON report surfaces are downstream renderings of that canonical report object rather than rival truth sources.
- **Operator lookup fail-open path:** `scripts/verify-m064-s03.ts` treats fixture keys as deterministic fixture-matrix input, but for non-fixture keys it now attempts live knowledge-store lookup and degrades to `lookup-unavailable` instead of throwing when Postgres or canonical-state access is unavailable.
- **M065 S02 live-proof composition:** the live large-PR proof wrapper normalizes retry-suffixed keys back to the base `reviewOutputKey`, composes runtime timing, visible review, and canonical operator evidence without redesigning runtime behavior, and fails explicitly when those seams disagree or do not prove a representative bundle.
- **M065 S03 fresh-regression composition:** the milestone closeout path preserves fresh regression proof under `nested_reports.regression_gate`, validates rollout runbook/package drift mechanically, and projects `M065-FRESH-REGRESSION-PROOF` from authoritative `nested_reports.s03` rather than synthesized placeholder state.
- **Milestone composition verifier:** `scripts/verify-m065.ts` is a composition-only proof harness. It preserves raw nested verifier payloads, exposes stable top-level check ids and drill-down metadata, and reports future rollout obligations as explicit pending/skipped data instead of silently omitting them.
- **Truthful checkpoint acknowledgement:** MCP checkpoint persistence only reports `saved: true` after the underlying durable write resolves; failures stay on the error path instead of fabricating evidence durability.
- **Failure-path canonicalization:** retry enqueue failure, retry execution failure, telemetry projection degradation, and stale supersession are all projected into canonical continuation-family state rather than left implicit in logs or transient coordinator state.
- **Deterministic proof:** `scripts/verify-m062-s01.ts` validates bounded-vs-dead-end classification from the production first-pass seam, `scripts/verify-m062-s03.ts` validates visible-surface semantic alignment, `scripts/verify-m063-s01.ts` validates automatic continuation scheduling/settlement/authority suppression, `scripts/verify-m063-s02.ts` validates same-surface ownership and revision/no-delta behavior, `scripts/verify-m063-s03.ts` validates bounded continuation shaping and truthful authority-safe completion, `scripts/verify-m064-s01.ts` validates canonical continuation-family authority and stop-reason answers directly from durable state, `scripts/verify-m064-s02.ts` validates orchestration failure/supersession truth from the same canonical source, `scripts/verify-m064-s03.ts` validates the operator evidence/report contract from canonical state without requiring log or checkpoint correlation, `scripts/verify-m065-s02.ts` validates live-proof identity/evidence composition for one representative large PR, `scripts/verify-m065-s03.ts` validates fresh regression proof plus rollout rerun packaging, and `scripts/verify-m065.ts` validates composed milestone-level evidence preservation plus remaining rollout obligations.
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
- [x] M064: Continuation state, supersession, and operator evidence — canonical continuation-family truth, truthful checkpoint durability, and operator evidence/report surfaces complete.
- [ ] M065: Live hardening and rollout proof — S01/S02/S03 code and packaging complete; milestone close remains blocked on live representative large-PR proof evidence from S02.

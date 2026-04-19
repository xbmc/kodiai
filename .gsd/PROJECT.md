# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestones M043, M044, M045, M046, M047, and **M051** are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, M045 turned contributor experience into one explicit cross-surface product contract, M046 turned contributor-tier calibration into a repeatable proof surface with an explicit replacement contract, M047 shipped that replacement rollout through the live review/runtime, Slack/profile, retrieval, identity, and milestone-close verification surfaces, and M051 closed the manual rereview truthfulness gap plus the remaining M048 operator/verifier proof-surface debt.

**M051 is complete.** The repo now carries one truthful manual rereview contract and one repaired M048 verifier contract:

- **Manual rereview contract:** `@kodiai review` is the only supported manual rereview trigger.
- **Retired path:** team-only `pull_request.review_requested` deliveries — including `ai-review` / `aireview` — are no longer a supported operator rereview mechanism and remain only as skipped negative evidence (`skipReason=team-only-request`).
- **Proof surfaces:** explicit manual rereviews are now evidenced by mention completion and publish-resolution logs carrying `lane=interactive-review` plus `taskType=review.full`.
- **Config/docs/runtime alignment:** the stale rereview-team config keys, helper/runtime path, checked-in example config, operator runbook, and smoke proof surfaces were all cleaned up together so the repo no longer advertises an unproven UI-team trigger.
- **Requirement status:** **R055 is validated** on the shipped contract above.
- **Residual truthfulness debt:** the M048 parser/verifier surfaces now preserve matched-but-invalid correlated phase evidence as `invalid-phase-payload`, use tri-state publication wording (`publication unknown` when appropriate), and keep downstream S03 reporting pinned to the repaired S01 summary string.
- **Known debt on this axis:** no known PR #87 operator/verifier truthfulness debt remains on `main` after M051.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Manual rereview contract:** `@kodiai review` is the only supported manual rereview trigger. Team-only `pull_request.review_requested` events — including `ai-review` / `aireview` — are retired as operator triggers and should surface only as skipped manual-trigger negatives.
- **Manual rereview observability seam:** explicit manual review proof now comes from mention completion/publish evidence (`lane=interactive-review`, `taskType=review.full`, approval/fallback publish resolution), not from reviewer-team topology or self-generated open-event requests.
- **Self-event filter invariant:** `src/webhook/filters.ts` always drops app-originated events, so self-generated reviewer/team requests cannot be used as proof for human manual rereview behavior.
- **Phase-timing evidence seam:** `src/review-audit/phase-timing-evidence.ts` preserves matched correlated rows even when interpretation fields are missing, marks them as `invalid-phase-payload`, and leaves downstream verifiers enough evidence to diagnose malformed payload drift truthfully.
- **Shared M048 outcome-summary seam:** `scripts/verify-m048-s01.ts` owns the tri-state phase-timing wording (`published output`, `no published output`, `publication unknown`, and true no-evidence handling), while `verify:m048:s03` reuses that summary verbatim instead of rebuilding its own prose.
- **Timeout Review Details typing seam:** `TimeoutReviewDetailsProgress` in `src/lib/review-utils.ts` is the single source of truth for timeout progress formatting consumed by `src/handlers/review.ts`.
- **Contributor-experience contract seam:** `src/contributor/experience-contract.ts` separates contributor-signal provenance/coarseness from surface behavior so review prompt shaping, Review Details, retrieval hints, Slack profile output, and identity-link copy stay truthful and non-contradictory.
- **Persisted contributor trust seam:** `src/contributor/profile-trust.ts` and migration `037-contributor-profile-trust.sql` establish the versioned trust boundary between stored profile data and user-facing behavior.
- **Shared runtime review resolver:** `src/contributor/review-author-resolution.ts` centralizes trust-aware review classification and fail-open fallback precedence.
- **Stored-profile Slack/profile resolver:** `src/contributor/profile-surface-resolution.ts` is the downstream persisted-profile seam; only `profile-backed` projections may claim active linked guidance or fetch expertise.
- **Opted-out system-view identity suppression:** internal contributor lookups that need to distinguish opted-out from absent profiles must use `includeOptedOut: true` and keep opted-out outcomes generic.
- **Calibration fixture proof seam:** `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-snapshot.ts`, and `scripts/verify-m046-s01.ts` separate human-curated contributor truth from generated live evidence so calibration work can rerun against a stable xbmc corpus.
- **Calibration evaluator seam:** `src/contributor/calibration-evaluator.ts` compares the modeled live incremental path against the intended full-signal path, preserves retained/excluded cohort truth, and reports fidelity/degradation limits instead of fabricating replay evidence.
- **Calibration change-contract seam:** `src/contributor/calibration-change-contract.ts` converts calibration recommendations into explicit keep/change/replace mechanisms with evidence, impacted surfaces, and contradiction checks for downstream rollout work.
- **Composable proof harnesses:** `scripts/verify-m045-s03.ts`, `scripts/verify-m046.ts`, `scripts/verify-m047-s01.ts`, `scripts/verify-m047-s02.ts`, and `scripts/verify-m047.ts` emit stable check IDs/status codes from normalized report objects so downstream slices and milestone validators can consume them mechanically.
- **Verifier false-green defense:** milestone verifiers must fail on forbidden evidence reappearing, not just on required evidence disappearing; the current examples are `verify:m047` rejecting leaked opt-out linked continuity with `slack_profile_evidence_drift` and the M048 truthfulness surfaces rejecting incomplete correlated phase rows as invalid payload drift instead of green evidence.
- **Explicit `not_applicable` handling:** when a scenario has no truthful surface (for example coarse-fallback Slack/profile continuity), the verifier should emit `not_applicable` instead of inventing synthetic passing evidence.
- **Deploy/runtime proof surfaces:** `deploy.sh` prints the active ACA revision plus `/healthz` and `/readiness` URLs; operator runbooks and verifiers rely on structured publication evidence rather than ad hoc inspection.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001–M042: MVP through contributor-tier truthfulness and mention-review production repair groundwork
- [x] M043: Restore Mention Review Publication and Reverify PR #80
  - [x] S01: Live Mention Publish Repair
  - [x] S02: Publish Failure Hardening and Deploy Safety
  - [x] S03: Backport Hotfixes onto PR #80
  - [x] S04: Finish PR #80 Review Fixes
  - [x] S05: Final Production and PR Proof
- [x] M044: Audit Recent XBMC Review Correctness
  - [x] S01: Sample Selection and Recent Review Audit
  - [x] S02: Audit-Driven Publication/Correctness Repair
  - [x] S03: Repeatable Audit Verifier and Runbook
- [x] M045: Contributor Experience Product Contract and Architecture
  - [x] S01: Contract-Driven GitHub Review Behavior
  - [x] S02: Unified Slack, Opt-Out, and Retrieval Semantics
  - [x] S03: Operator Verifier for Cross-Surface Contract Drift
- [x] M046: Contributor Tier Calibration and Fixture Audit
  - [x] S01: Contributor Fixture Set
  - [x] S02: Scoring and Tiering Evaluation
  - [x] S03: Calibration Verdict and Change Contract
- [x] M047: Contributor Experience Redesign and Calibration Rollout
  - [x] S01: Review-Surface Rollout
  - [x] S02: Retrieval and Slack Surface Rollout
  - [x] S03: End-to-End Coherence Verification
- [x] M051: Manual rereview trigger truthfulness
  - [x] S01: Rereview trigger proof and decision
  - [x] S02: Manual rereview contract implementation
  - [x] S03: Residual operator truthfulness cleanup

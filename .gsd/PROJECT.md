# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestones M043, M044, M045, M046, and M047 are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, M045 turned contributor experience into one explicit cross-surface product contract, M046 turned contributor-tier calibration into a repeatable proof surface with an explicit replacement contract, and M047 shipped that replacement rollout through the live review/runtime, Slack/profile, retrieval, identity, and milestone-close verification surfaces.

**M051 is active.** Its focus is manual rereview trigger truthfulness and the remaining operator/verifier truthfulness cleanup around the review flow.

**M051/S01 and M051/S02 are complete and verified.** The project now has a settled manual rereview contract:

- S01 proved the GitHub UI-team topology (`aireview` exists, has repo access, includes `kodiai`) but also proved that topology is not operator-path proof.
- Decisions **D124** and **D125** established the truthful closure path: keep `@kodiai review` as the supported operator contract unless fresh human-generated `pull_request.review_requested` evidence exists for the UI-team path, otherwise remove the stale contract.
- S02 executed that removal path: `review.uiRereviewTeam` / `review.requestUiRereviewTeamOnOpen` are gone from runtime config/schema/defaults/examples, the rereview-team helper/runtime path is deleted, team-only `pull_request.review_requested` deliveries now skip cleanly, and operator docs/smoke artifacts no longer advertise `ai-review` / `aireview` as a supported manual trigger.
- Decision **D126** now defines the surviving proof surface: explicit `@kodiai review` runs are evidenced by mention completion logs carrying `lane=interactive-review` and `taskType=review.full`, while `ai-review` / `aireview` review requests remain observable only as skipped team-only events.
- **R055 is validated.** The repo no longer claims a nonexistent manual rereview path; `@kodiai review` is the only documented and regression-tested manual rereview trigger.

**M051/S03 remains next.** Its scope is the residual operator/verifier truthfulness debt exposed during PR #87 review work, now that manual rereview-path ambiguity is removed.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Manual rereview contract:** `@kodiai review` is the only supported manual rereview trigger. Team-only `pull_request.review_requested` events — including `ai-review` / `aireview` — are retired as operator triggers and should surface only as skipped manual-trigger negatives.
- **Manual rereview observability seam:** explicit manual review proof now comes from mention completion/publish evidence (`lane=interactive-review`, `taskType=review.full`, approval/fallback publish resolution), not from reviewer-team topology or self-generated open-event requests.
- **Self-event filter invariant:** `src/webhook/filters.ts` always drops app-originated events, so self-generated reviewer/team requests cannot be used as proof for human manual rereview behavior.
- **Contributor-experience contract seam:** `src/contributor/experience-contract.ts` separates contributor-signal provenance/coarseness from surface behavior so review prompt shaping, Review Details, retrieval hints, Slack profile output, and identity-link copy stay truthful and non-contradictory.
- **Persisted contributor trust seam:** `src/contributor/profile-trust.ts` and migration `037-contributor-profile-trust.sql` establish the versioned trust boundary between stored profile data and user-facing behavior.
- **Shared runtime review resolver:** `src/contributor/review-author-resolution.ts` centralizes trust-aware review classification and fail-open fallback precedence.
- **Stored-profile Slack/profile resolver:** `src/contributor/profile-surface-resolution.ts` is the downstream persisted-profile seam; only `profile-backed` projections may claim active linked guidance or fetch expertise.
- **Opted-out system-view identity suppression:** internal contributor lookups that need to distinguish opted-out from absent profiles must use `includeOptedOut: true` and keep opted-out outcomes generic.
- **Calibration fixture proof seam:** `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-snapshot.ts`, and `scripts/verify-m046-s01.ts` separate human-curated contributor truth from generated live evidence so calibration work can rerun against a stable xbmc corpus.
- **Calibration evaluator seam:** `src/contributor/calibration-evaluator.ts` compares the modeled live incremental path against the intended full-signal path, preserves retained/excluded cohort truth, and reports fidelity/degradation limits instead of fabricating replay evidence.
- **Calibration change-contract seam:** `src/contributor/calibration-change-contract.ts` converts calibration recommendations into explicit keep/change/replace mechanisms with evidence, impacted surfaces, and contradiction checks for downstream rollout work.
- **Composable proof harnesses:** `scripts/verify-m045-s03.ts`, `scripts/verify-m046.ts`, `scripts/verify-m047-s01.ts`, `scripts/verify-m047-s02.ts`, and `scripts/verify-m047.ts` emit stable check IDs/status codes from normalized report objects so downstream slices and milestone validators can consume them mechanically.
- **Verifier false-green defense:** milestone verifiers must fail on forbidden evidence reappearing, not just on required evidence disappearing; the current example is `verify:m047` rejecting leaked opt-out linked continuity with `slack_profile_evidence_drift`.
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
- [ ] M051: Manual rereview trigger truthfulness
  - [x] S01: Rereview trigger proof and decision
  - [x] S02: Manual rereview contract implementation
  - [ ] S03: Residual operator truthfulness cleanup

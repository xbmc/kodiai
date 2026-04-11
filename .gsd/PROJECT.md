# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestones M043, M044, M045, and M046 are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, M045 turned contributor experience into one explicit cross-surface product contract, and M046 turned contributor-tier calibration into a repeatable proof surface with an explicit replacement contract for M047.

M047 is now in progress with **S01 complete**. The GitHub review surface no longer trusts raw persisted contributor tiers by default:

- `src/db/migrations/037-contributor-profile-trust.sql` adds a persisted nullable `trust_marker` so contributor profiles can distinguish linked-unscored, legacy, stale, malformed, and currently calibrated rows.
- `src/contributor/profile-trust.ts` is the canonical persisted-row trust classifier; it derives trust from `overallTier`, `lastScoredAt`, and the versioned marker instead of inferring certainty from raw tier labels.
- `src/contributor/review-author-resolution.ts` is the shared runtime resolver that applies the trust boundary before falling back to author-cache, GitHub search, or generic/degraded behavior.
- `src/handlers/review.ts` now keeps prompt shaping, Review Details, and author-classification logs coherent across linked-unscored, legacy, stale, calibrated, opt-out, and coarse-fallback scenarios.
- `scripts/verify-m047-s01.ts` is the operator-facing proof surface for the runtime stored-profile resolution seam; it reports stable scenario-level checks and trust/contract/source/fallback diagnostics.

Fresh M047/S01 verification passed:

- `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts ./scripts/verify-m047-s01.test.ts`
- `bun run verify:m045:s01 && bun run verify:m047:s01`
- `bun run tsc --noEmit`

What remains before M047 closes:

- **S02:** roll the same trust-aware contributor resolution through retrieval hints, Slack/profile continuity output, and related downstream surfaces.
- **S03:** compose the review/runtime proof with the existing M045/M046 verifiers into the integrated `verify:m047` milestone coherence harness.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Contributor-experience contract seam:** `src/contributor/experience-contract.ts` separates contributor-signal provenance/coarseness from surface behavior so review prompt shaping, Review Details, retrieval hints, Slack profile output, and identity-link copy stay truthful and non-contradictory.
- **Persisted contributor trust seam:** `src/contributor/profile-trust.ts` and migration `037-contributor-profile-trust.sql` establish the versioned trust boundary between stored profile data and user-facing behavior.
- **Shared runtime review resolver:** `src/contributor/review-author-resolution.ts` centralizes trust-aware review classification and fail-open fallback precedence.
- **Calibration fixture proof seam:** `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-snapshot.ts`, and `scripts/verify-m046-s01.ts` separate human-curated contributor truth from generated live evidence so calibration work can rerun against a stable xbmc corpus.
- **Calibration evaluator seam:** `src/contributor/calibration-evaluator.ts` compares the modeled live incremental path against the intended full-signal path, preserves retained/excluded cohort truth, and reports fidelity/degradation limits instead of fabricating replay evidence.
- **Calibration change-contract seam:** `src/contributor/calibration-change-contract.ts` converts calibration recommendations into explicit keep/change/replace mechanisms with evidence, impacted surfaces, and contradiction checks for downstream rollout work.
- **Operator proof harnesses:** `scripts/verify-m045-s03.ts`, `scripts/verify-m046-s02.ts`, `scripts/verify-m046.ts`, and `scripts/verify-m047-s01.ts` emit stable check IDs/status codes from normalized report objects so downstream slices and milestone validators can consume them mechanically.
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
- [ ] M047: Contributor Experience Redesign and Calibration Rollout
  - [x] S01: Review-Surface Rollout
  - [ ] S02: Retrieval and Slack Surface Rollout
  - [ ] S03: End-to-End Coherence Verification

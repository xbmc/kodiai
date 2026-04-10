# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestones M043, M044, M045, and M046 are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, M045 turned contributor experience into one explicit cross-surface product contract, and M046 turned contributor-tier calibration into a repeatable proof surface with an explicit replacement contract for M047.

The current contributor-calibration state is now explicit and verified:

- `fixtures/contributor-calibration/xbmc-manifest.json` and `fixtures/contributor-calibration/xbmc-snapshot.json` are the checked-in xbmc truth set with explicit retained/excluded identities, provenance, source availability, and deterministic timestamps.
- `src/contributor/xbmc-fixture-snapshot.ts` is the shared offline loader/validator so verifiers and evaluators consume one authoritative snapshot contract.
- `src/contributor/calibration-evaluator.ts` models the current live incremental path versus the intended full-signal path without inventing changed-file arrays, projects both through the M045 contributor-experience contract, and preserves instability/freshness diagnostics.
- `src/contributor/calibration-change-contract.ts` turns the calibration recommendation plus current runtime seams into a deterministic keep/change/replace inventory with explicit impacted surfaces and contradiction validation.
- `bun run verify:m046 -- --json` is the canonical integrated proof surface. It preserves nested S01 fixture evidence and nested S02 calibration evidence, reports stable top-level `M046-S03-*` checks, states the explicit verdict, and emits a concrete `m047ChangeContract`.
- The current M046 verdict is **`replace`**. The contract says to keep the M045 contributor-experience vocabulary, change stored-tier consumer surfaces in review and Slack so they can read a future calibrated contract, and replace the live incremental `pr_authored`-only scoring path.
- Requirement `R047` is validated with milestone-level proof, including the integrated verifier and the full M046 test suite.

Fresh milestone-closeout verification passed:

- `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s02.test.ts ./src/contributor/calibration-change-contract.test.ts ./scripts/verify-m046.test.ts`
- `bun run verify:m046 -- --json`
- `bun run tsc --noEmit`

What remains is the rollout milestone that consumes the now-explicit M046 contract:

- **M047:** implement the contributor-experience redesign/calibration changes described by `m047ChangeContract`, preserve freshness/degradation reporting, and prove end-to-end cross-surface coherence.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Contributor-experience contract seam:** `src/contributor/experience-contract.ts` separates contributor-signal provenance/coarseness from surface behavior so review prompt shaping, Review Details, retrieval hints, Slack profile output, and identity-link copy stay truthful and non-contradictory.
- **Calibration fixture proof seam:** `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-snapshot.ts`, and `scripts/verify-m046-s01.ts` separate human-curated contributor truth from generated live evidence so calibration work can rerun against a stable xbmc corpus.
- **Calibration evaluator seam:** `src/contributor/calibration-evaluator.ts` compares the modeled live incremental path against the intended full-signal path, preserves retained/excluded cohort truth, and reports fidelity/degradation limits instead of fabricating replay evidence.
- **Calibration change-contract seam:** `src/contributor/calibration-change-contract.ts` converts calibration recommendations into explicit keep/change/replace mechanisms with evidence, impacted surfaces, and contradiction checks for downstream rollout work.
- **Operator proof harnesses:** `scripts/verify-m045-s03.ts`, `scripts/verify-m046-s02.ts`, and `scripts/verify-m046.ts` emit stable check IDs/status codes from one normalized report object so downstream slices and milestone validators can consume them mechanically.
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
  - [ ] S01: Review-Surface Rollout
  - [ ] S02: Retrieval and Slack Surface Rollout
  - [ ] S03: End-to-End Coherence Verification

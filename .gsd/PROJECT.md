# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestones M043, M044, and M045 are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, and M045 turned contributor experience into one explicit cross-surface product contract.

M046 is now in progress with S01 complete. S01 established the checked-in xbmc calibration corpus and its proof surface:

- `fixtures/contributor-calibration/xbmc-manifest.json` now carries the curated xbmc retained/excluded truth set with explicit bot, alias-collision, and ambiguous-identity handling.
- `fixtures/contributor-calibration/xbmc-snapshot.json` now carries the refreshed contributor snapshot with machine-readable provenance, source-availability diagnostics, and deterministic timestamps.
- `bun run verify:m046:s01 -- --json` and `bun run verify:m046:s01 -- --refresh --json` now verify the fixture pack with stable `check_ids` / `status_code` values for manifest validity, snapshot sync, cohort coverage, provenance completeness, source availability, and alias diagnostics.

Fresh S01 verification passed:

- `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts`
- `bun run verify:m046:s01 -- --json`
- `bun run verify:m046:s01 -- --refresh --json`
- `bun run tsc --noEmit`

What remains is the calibration verdict path:
- **M046/S02:** evaluate live incremental-path behavior versus the intended full-signal model against the checked-in xbmc fixtures.
- **M046/S03:** turn the fixture and evaluator evidence into an explicit keep/retune/replace verdict plus an M047 change contract.
- **M047:** roll out the contributor-experience redesign/calibration changes and prove end-to-end cross-surface coherence.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Contributor-experience contract seam:** `src/contributor/experience-contract.ts` separates contributor-signal provenance/coarseness from surface behavior so review prompt shaping, Review Details, retrieval hints, Slack profile output, and identity-link copy stay truthful and non-contradictory.
- **Calibration fixture proof seam:** `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, and `scripts/verify-m046-s01.ts` separate human-curated contributor truth from generated live evidence so downstream calibration work can rerun against a stable xbmc corpus.
- **Cross-surface drift verifier:** `scripts/verify-m045-s03.ts` preserves the S01 GitHub proof report intact and adds independent retrieval, Slack, and identity-link checks so operators can confirm contributor-experience coherence from one command.
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
- [ ] M046: Contributor Tier Calibration and Fixture Audit
  - [x] S01: Contributor Fixture Set
  - [ ] S02: Scoring and Tiering Evaluation
  - [ ] S03: Calibration Verdict and Change Contract
- [ ] M047: Contributor Experience Redesign and Calibration Rollout
  - [ ] S01: Review-Surface Rollout
  - [ ] S02: Retrieval and Slack Surface Rollout
  - [ ] S03: End-to-End Coherence Verification

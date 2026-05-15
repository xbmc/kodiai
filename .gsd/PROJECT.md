# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, multi-model routing, explicit mention-driven review handling, explicit same-PR formatter suggestions, a shadow-only docs/config/runbook truthfulness specialist lane pilot, candidate verification/disagreement handling for that lane's candidate-approved publication path, and artifact-backed GSD closeout traceability.

Milestones M043, M044, M045, M046, M047, M051, M053, M066, M069, M070, M071, and dummy are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into `verify:m044`, M045 turned contributor experience into one explicit cross-surface product contract, M046 made contributor-tier calibration repeatable, M047 shipped the replacement contributor-experience rollout, M051 closed the manual rereview truthfulness gap, M053 shipped same-PR formatter suggestions, M066 records the accepted live formatter-suggestion proof lineage, M069 introduced the docs/config/runbook truthfulness specialist as a same-job shadow-only subflow, M070 added publication-safe candidate verification and disagreement handling, M071 completed the issue #131 foundation contract and completion audit, and dummy completed an artifact-only closeout evidence set.

**M071 is complete: Issue #131 Completion Audit and Plan Contract.** Normal review handling now constructs a typed `ReviewPlan` before publication-side effects, carries a stable hash and safe diagnostics, renders a compact public Review Plan summary in Review Details, and preserves review behavior by failing open on optional plan/formatting diagnostics failures. `review.graphValidation.enabled` is now a typed repo-config contract with disabled-by-default behavior, documented bounds, direct normal-handler consumption, ReviewPlan gate/status evidence, and bounded runtime logs for enabled/applied/skipped/unavailable/fail-open outcomes.

M071 also provides the source-owned issue #131 completion matrix and package verifier surface. `verify:m071 -- --json` is the foundation-only proof: it must report six complete M071 foundation rows, zero partial rows, zero missing rows, four explicitly deferred rows, exact package wiring, safe bounded output, and no issues. The verifier fails closed on weak evidence such as comments, inert strings, untyped casts, missing source paths, malformed package scripts, unsafe report fields, owner drift, or planning-artifact evidence.

M071 intentionally does **not** claim full issue #131 completion. It re-owned R104 repo-doctrine implementation/proof outside M071 to M074/S01, and it preserves downstream handoff rows for M072/S01 candidate publication bridge, M073/S01 reducer extraction, M074/S01 specialist lane proof, and M075/S01 metrics/tier closure. The checked-in `src/issue-131/deferred-handoff.ts` contract is the durable handoff source consumed by `verify:m071`; markdown and `.gsd` planning artifacts are narrative only.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **ReviewPlan contract seam:** `src/review-plan/review-plan.ts` owns typed review orchestration evidence, stable `review-plan:v1:` hashes, safe diagnostic projection, and compact public Review Details projection. Runtime construction is wired into `src/handlers/review.ts` before publication-side effects, but diagnostics failures must fail open.
- **ReviewPlan public-surface invariant:** GitHub-visible Review Details gets only a bounded compact Review Plan summary; richer plan details stay in structured logs and verifier output. Raw prompts, raw model output, candidate payloads, diffs, comments, secrets, and safety-obscuring identifiers must not appear in the public projection.
- **Graph-validation truthfulness seam:** `review.graphValidation` in `src/execution/config.ts` is typed, documented, disabled by default, and consumed directly by the normal review handler. `src/review-graph/graph-validation-status.ts` maps enabled/applied/skipped/unavailable/failure states into bounded ReviewPlan/runtime evidence.
- **Issue #131 matrix seam:** `src/issue-131/evidence-matrix.ts` classifies acceptance rows as `complete`, `partial`, `missing`, or `deferred` using checked-in source evidence only. Package verifier wiring is itself a foundation row, and completion means M071 foundation closure only.
- **Issue #131 deferred handoff seam:** `src/issue-131/deferred-handoff.ts` is the source-owned contract for M072-M075 ownership plus R104 ownership resolution. `docs/issue-131-handoff.md` explains the handoff, but the verifier consumes the source module, not planning prose.
- **Composable proof harnesses:** milestone verifiers emit stable check IDs/status codes from normalized report objects so downstream slices and validators can consume them mechanically.
- **Verifier false-green defense:** milestone verifiers must fail on forbidden evidence reappearing, not just on required evidence disappearing. M071 rejects weak source evidence, raw report fields, planning evidence paths, malformed package wiring, deferred-owner drift, and R104 reassignment back to M071 without source implementation proof.
- **Shadow specialist contract seam:** `src/specialists/shadow-specialist.ts` owns the `docs-config-truth` lane identity, operator-truth path classification, bounded output normalization, candidate counts, metric availability, correlation keys, and redaction/publication-hazard diagnostics.
- **Candidate publication policy seam:** `src/specialists/candidate-publication-policy.ts` and `src/execution/mcp/review-output-publication-gate.ts` enforce candidate verification before GitHub-visible candidate-approved publication.
- **Formatter-suggestion orchestration seam:** `src/handlers/formatter-suggestion-orchestration.ts` composes formatter command execution, PR diff collection, commentability indexing, diff mapping, head-SHA resolution, and batched same-PR review publication into bounded results.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Deploy/runtime proof surfaces:** `deploy.sh` prints the active ACA revision plus `/healthz` and `/readiness` URLs; operator runbooks and verifiers rely on structured publication evidence rather than ad hoc inspection.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping. M071 validates R125-R129 for issue #131 foundation proof, normal ReviewPlan construction, Review Details plan summary, typed/truthful graph-validation configuration, and fail-closed completion-matrix semantics. R104 is deferred outside M071 to M074/S01; M071 validates only the ownership correction and handoff evidence, not repo-doctrine implementation. R130-R133 remain downstream active requirements owned by M072-M075 rather than implied complete by M071.

M069 advanced R102 and R105 with a shadow-only docs/config/runbook specialist lane, bounded candidate/reducer metrics, and proof surfaces; M070 validates R102, R103, R117, and R118 for the docs/config truth lane's candidate verification/disagreement publication contract. R105 remains active/partial for full shadow rollout metrics and Fast/Standard/Deep/Critical tier graduation. M053 validates explicit formatter-suggestion requirements R076-R085; R086 remains deferred for automatic-mode proof, R087 remains deferred for adapter expansion, and R089-R091 remain out of scope as negative constraints.

## Milestone Sequence

- [x] M001-M042: MVP through contributor-tier truthfulness and mention-review production repair groundwork
- [x] M043: Restore Mention Review Publication and Reverify PR #80
- [x] M044: Audit Recent XBMC Review Correctness
- [x] M045: Contributor Experience Product Contract and Architecture
- [x] M046: Contributor Tier Calibration and Fixture Audit
- [x] M047: Contributor Experience Redesign and Calibration Rollout
- [x] M051: Manual rereview trigger truthfulness
- [x] M053: Same-PR Formatter Suggestions
- [x] M066: Same-PR Formatter Suggestions live-smoke lineage
- [x] M069: Specialist Lane Pilot
- [x] M070: Candidate Verification + Disagreement Handling
- [x] M071: Issue #131 Completion Audit and Plan Contract
  - [x] S01: Issue #131 evidence matrix and `verify:m071` surface
  - [x] S02: Typed ReviewPlan contract in normal review handling
  - [x] S03: Compact public Review Plan summary in Review Details
  - [x] S04: Typed and truthful `review.graphValidation.enabled` config/status
  - [x] S05: Final foundation-only M071 verifier contract with deferred owners
  - [x] S06: R104 ownership resolution and downstream source-backed handoff
- [x] dummy: Artifact-only GSD closeout evidence

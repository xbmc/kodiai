# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, and multi-model routing.

Milestones M043, M044, M045, M046, and M047 are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, M045 turned contributor experience into one explicit cross-surface product contract, M046 turned contributor-tier calibration into a repeatable proof surface with an explicit replacement contract, and M047 shipped that replacement rollout through the live review/runtime, Slack/profile, retrieval, identity, and milestone-close verification surfaces.

**M047 is complete and verified.** The contributor-experience rollout now has one truthful persisted-profile trust boundary and one canonical milestone-close proof surface:

- `src/db/migrations/037-contributor-profile-trust.sql` and `src/contributor/profile-trust.ts` established the persisted versioned trust-marker seam so linked-unscored, legacy, stale, malformed, calibrated, and opted-out rows can be distinguished truthfully.
- `src/contributor/review-author-resolution.ts` is the shared review-time resolver that applies stored-profile trust before falling back to author-cache, GitHub search, or generic/degraded behavior.
- `src/contributor/profile-surface-resolution.ts` is the canonical Slack/profile continuity seam for persisted profiles; only current trusted calibrated rows stay `profile-backed`, while linked-unscored, legacy, stale, malformed, and fail-open rows collapse to truthful generic continuity.
- `src/slack/slash-command-handler.ts` routes `/kodiai profile`, `link`, and `profile opt-in` through that stored-profile surface resolver before rendering copy or looking up expertise.
- `src/handlers/identity-suggest.ts` uses system-view `includeOptedOut: true` lookups so opted-out linked contributors suppress link DMs without re-enabling contributor-specific guidance.
- `scripts/verify-m047-s01.ts` remains the operator-facing proof surface for runtime stored-profile resolution on the review path.
- `scripts/verify-m047-s02.ts` is the operator-facing downstream proof surface for Slack/profile output, continuity copy, retrieval hints, and opt-out identity suppression, composed from the embedded S01 runtime report plus a local stored-profile scenario matrix.
- `scripts/verify-m047.ts` is the canonical milestone-close coherence verifier. It composes `verify:m047:s02`, `verify:m045:s03`, and `verify:m046`, preserves their nested JSON verbatim, reports four stable top-level checks plus five milestone scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`), treats the M046 `replace` recommendation as data rather than a harness failure, and fails loudly on malformed nested evidence, mapping drift, or leaked forbidden opt-out continuity.

Fresh milestone-close verification passed:

- `bun test ./scripts/verify-m047.test.ts`
- `bun run verify:m047 -- --json`
- `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`
- `bun run tsc --noEmit`

Requirements `R046` and `R048` are validated, and future contributor-resolution changes should extend `verify:m047` rather than introducing parallel proof paths.

**M048 is active with S01 and S02 complete.** The live review path now has one truthful six-phase evidence contract plus the first shipped single-worker latency-reduction pass:

- `src/jobs/queue.ts`, `src/handlers/review.ts`, `src/execution/executor.ts`, and `src/review-audit/phase-timing-evidence.ts` emit and normalize one correlated six-phase `Review phase timing summary` keyed by `deliveryId` and `reviewOutputKey`.
- GitHub Review Details renders the same ordered phase matrix operators query in Azure via `scripts/verify-m048-s01.ts`.
- `src/jobs/aca-launcher.ts` now uses a shared 5s ACA poll cadence and debug-only malformed/unknown status drift diagnostics without moving the `remote runtime` timing boundary.
- `src/execution/executor.ts` and `src/execution/agent-entrypoint.ts` now use a canonical `repoTransport` handoff seam that restores the cheaper review-bundle transport/materialization path while preserving origin-based git behavior, shallow-repo correctness, and malformed-config fail-fast behavior.
- `scripts/verify-m048-s02.ts` is the operator compare surface for before/after latency proof. It embeds full S01 verifier reports for baseline and candidate, compares only `workspace preparation`, `executor handoff`, and `remote runtime`, and evaluates publication continuity separately so faster runtime results cannot hide GitHub publication regressions.
- Env-backed M048 verifiers now skip truthfully when required review-key flags are present but empty because automation expanded unset vars to nothing; they no longer misparse the next `--flag` as a live review key.

The remaining M048 work is S03: truthful bounded-review behavior and synchronize-trigger continuity. `R050` is still active because the final live before/after latency proof requires one fresh deployed baseline/candidate review pair inside the verifier's 14-day evidence window.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Contributor-experience contract seam:** `src/contributor/experience-contract.ts` separates contributor-signal provenance/coarseness from surface behavior so review prompt shaping, Review Details, retrieval hints, Slack profile output, and identity-link copy stay truthful and non-contradictory.
- **Persisted contributor trust seam:** `src/contributor/profile-trust.ts` and migration `037-contributor-profile-trust.sql` establish the versioned trust boundary between stored profile data and user-facing behavior.
- **Shared runtime review resolver:** `src/contributor/review-author-resolution.ts` centralizes trust-aware review classification and fail-open fallback precedence.
- **Stored-profile Slack/profile resolver:** `src/contributor/profile-surface-resolution.ts` is the downstream persisted-profile seam; only `profile-backed` projections may claim active linked guidance or fetch expertise.
- **Opted-out system-view identity suppression:** internal contributor lookups that need to distinguish opted-out from absent profiles must use `includeOptedOut: true` and keep opted-out outcomes generic.
- **Calibration fixture proof seam:** `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-snapshot.ts`, and `scripts/verify-m046-s01.ts` separate human-curated contributor truth from generated live evidence so calibration work can rerun against a stable xbmc corpus.
- **Calibration evaluator seam:** `src/contributor/calibration-evaluator.ts` compares the modeled live incremental path against the intended full-signal path, preserves retained/excluded cohort truth, and reports fidelity/degradation limits instead of fabricating replay evidence.
- **Calibration change-contract seam:** `src/contributor/calibration-change-contract.ts` converts calibration recommendations into explicit keep/change/replace mechanisms with evidence, impacted surfaces, and contradiction checks for downstream rollout work.
- **Latency evidence seam:** `src/execution/types.ts`, `src/handlers/review.ts`, `src/lib/review-utils.ts`, `src/review-audit/phase-timing-evidence.ts`, and `scripts/verify-m048-s01.ts` share one six-phase timing contract across runtime logs, GitHub Review Details, and Azure-backed operator verification.
- **Single-worker repo transport seam:** `resolveRepoTransport(...)` is the canonical handoff contract between executor and worker entrypoint; it keeps optimized review-bundle transport, legacy fallback, and malformed-config failure behavior aligned in one place.
- **Latency compare seam:** `scripts/verify-m048-s02.ts` composes two full S01 reports, computes deltas only over the phases S02 actually targets, and keeps publication continuity as an explicit separate state.
- **Env-backed verifier skip pattern:** verifier CLI parsers must refuse to consume another `--flag` as a missing value and should emit named skipped statuses when automation passes empty live-proof inputs.
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
- [ ] M048: PR Review Latency Reduction and Bounded Execution
  - [x] S01: Live Phase Timing and Operator Evidence Surfaces
  - [x] S02: Single-Worker Path Latency Reduction
  - [ ] S03: Truthful Bounded Reviews and Synchronize Continuity

# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, multi-model routing, and explicit mention-driven review handling.

Milestones M043, M044, M045, M046, M047, and **M051** are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, M045 turned contributor experience into one explicit cross-surface product contract, M046 turned contributor-tier calibration into a repeatable proof surface with an explicit replacement contract, M047 shipped that replacement rollout through the live review/runtime, Slack/profile, retrieval, identity, and milestone-close verification surfaces, and M051 closed the manual rereview truthfulness gap plus the remaining M048 operator/verifier proof-surface debt.

**M066 is active: Same-PR Formatter Suggestions.** S01, S02, S03, and S04 are complete; S05 remains for live GitHub smoke proof and operator docs.

S01 established the default-off formatter-suggestion config plus explicit mention intent contract:

- `review.formatterSuggestions` exists with `automatic: false` by default, optional `command`, and bounded `maxSuggestions` defaulting to `10`.
- Explicit formatter-suggestion mentions such as `@kodiai format suggestions` and `@kodiai suggest formatting fixes` are recognized without requiring automatic mode or a configured command.
- Combined `@kodiai review & format suggestions` requests preserve the normal explicit review lane while carrying a formatter-suggestion descriptor for later orchestration.
- Format-only formatter-suggestion requests stay read-only and do not trigger write mode.
- Requirements **R076** and **R079** are validated by M066/S01 test evidence.

S02 delivered the pure formatter execution and diff-to-suggestion mapping contract for downstream publication/orchestration:

- `src/execution/formatter-suggestions.ts` exposes a side-effect-injected formatter command runner with `no-command`, `no-op`, `success`, `failed`, and `timed-out` statuses.
- Formatter commands substitute only `{baseRef}`, `{headRef}`, and `{diffRange}`; unknown brace placeholders remain literal.
- Formatter stderr summaries are bounded and redacted before becoming visible diagnostics.
- Formatter git unified diffs parse into conservative file/hunk/line models with old/current and new/formatted cursor positions.
- Binary, added, deleted, renamed, malformed file, malformed hunk, pure insertion, pure deletion, path mismatch, and off-PR-diff cases are skipped rather than guessed.
- `buildPrDiffCommentabilityIndex()` records PR diff RIGHT-side commentable context/addition line numbers by path.
- `mapFormatterDiffToSuggestions()` emits S03-ready payloads with `path`, `line`, optional `startLine`, `side: "RIGHT"`, markdown suggestion block, raw `suggestionBody`, and source metadata, enforcing `maxSuggestions` after safety validation.
- Requirements **R078**, **R082**, and **R083** are validated by M066/S02 fixture/regression evidence.

S03 delivered the batched same-PR formatter suggestion publisher contract for downstream orchestration:

- `src/execution/formatter-suggestion-publisher.ts` exports `publishFormatterSuggestionReview()` and result/status types for publishing S02 `FormatterSuggestionPayload[]` as one GitHub Pull Request Review.
- The publisher uses exactly one `octokit.rest.pulls.createReview` call with `event: "COMMENT"`, caller-provided `commit_id`, a review body with optional `buildReviewOutputMarker(reviewOutputKey)`, and multiple inline `suggestion` comment bodies.
- Empty suggestion batches return `status: "no-suggestions"`; duplicate review-output keys return `status: "skipped"`; both avoid GitHub writes.
- Publication-gate failures, GitHub validation errors, and outgoing secret detections are surfaced as structured `failed` or `blocked` results with `posted: 0`, bounded/redacted messages, and no fallback to standalone comments, branch pushes, commits, or new PRs.
- Outgoing review and suggestion bodies are scanned for secrets before any write and have configured bot handles sanitized while preserving suggestion fences and idempotency markers.
- Requirement **R081** is validated by M066/S03 publisher/regression evidence. **R077** still requires S05 live GitHub committability proof.

S04 wired explicit formatter requests into the runtime mention handler with independent subflow results:

- `src/handlers/formatter-suggestion-orchestration.ts` exports `runFormatterSuggestionSubflow()` as the composition seam across the S02 formatter command/mapper and the S03 publisher.
- The helper returns structured statuses (`setup-needed`, `no-op`, `pr-diff-unavailable`, `mapped-no-suggestions`, `posted`, `duplicate`, `blocked`, `failed`) with bounded visible diagnostics for expected failures instead of throwing.
- Formatter publication uses a formatter-specific review-output key action (`mention-format-suggestions`) and the resolved PR head SHA so it does not collide with normal explicit review idempotency.
- Format-only PR mentions (`@kodiai format suggestions`, `@kodiai suggest formatting fixes`) short-circuit after checkout/config load, stay read-only, bypass Claude/executor entirely, and run only the formatter subflow.
- Combined mentions (`@kodiai review & format suggestions`) preserve existing explicit-review routing/publication while running formatter suggestions afterward; executor error results or thrown exceptions still attempt formatter when workspace/config/PR identity are available.
- Formatter diagnostic replies are posted only when the subflow returns a visible message; successful formatter PR reviews rely on the Pull Request Review as the visible success surface.
- Structured logs distinguish `formatterMode`, `formatterStatus`, `commandStatus`, `publisherStatus`, suggestion/skipped/capped counts, visible-reply outcomes, normal `reviewConclusion`/`publishResolution`, and combined partial-failure state without logging raw formatter stdout or unbounded stderr.
- Requirements **R080** and **R084** are validated by M066/S04 regression evidence.

Remaining M066 work: S05 must provide a deployed/live GitHub smoke proof that at least one Kodiai-generated formatter suggestion is accepted as a committable same-PR suggestion, then document operator setup and how maintainers can enable automatic mode later.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Formatter-suggestion config seam:** `review.formatterSuggestions` in `src/execution/config.ts` controls automatic formatter-suggestion inclusion separately from explicit mention access. `automatic` defaults false; downstream formatter slices should consume `command` and `maxSuggestions` from this nested config.
- **Formatter-suggestion mention seam:** `src/handlers/formatter-suggestion-intent.ts` is the pure parser for explicit formatter-suggestion requests. `src/handlers/mention.ts` stores the parsed descriptor on `ExecutionContext.formatterSuggestionRequest` so downstream execution/publishing code should not re-parse mention text.
- **Formatter-suggestion orchestration seam:** `src/handlers/formatter-suggestion-orchestration.ts` composes formatter command execution, PR diff collection, commentability indexing, formatter diff mapping, head-SHA resolution, and batched same-PR review publication into a structured subflow result. Expected runtime failures are returned as bounded statuses and visible messages, not thrown exceptions.
- **Formatter-suggestion routing invariant:** format-only suggestions remain read-only, bypass Claude, and must not enter write mode; combined `review-and-format` requests preserve explicit review routing while letting the formatter subflow run independently after review work.
- **Formatter command runner seam:** `src/execution/formatter-suggestions.ts` owns formatter command execution. It accepts injected process execution for tests, uses workspace cwd for the default Bun-backed runner, reports `no-command`/`no-op`/`success`/`failed`/`timed-out`, substitutes only `{baseRef}`, `{headRef}`, and `{diffRange}`, and never stages, commits, pushes, or publishes by itself.
- **Formatter diff parser seam:** formatter stdout is parsed conservatively into file/hunk/line models with old/current and new/formatted cursor positions. Unsupported or malformed diff states are structured skips, not partial guesses.
- **Formatter suggestion mapping seam:** `buildPrDiffCommentabilityIndex()` records RIGHT-side PR diff target lines, and `mapFormatterDiffToSuggestions()` validates every formatter replacement target line before emitting S03-batchable GitHub suggestion payloads. Caps are enforced after safety validation so skipped/capped counts stay truthful.
- **Formatter suggestion publisher seam:** `publishFormatterSuggestionReview()` in `src/execution/formatter-suggestion-publisher.ts` is the only S03 publisher. It consumes S02 payloads directly, uses a narrow `rest.pulls.createReview` Octokit port, creates one same-PR COMMENT review with batched inline suggestions, applies review-output idempotency gates, scans outgoing content for secrets, sanitizes configured bot handles, and reports all-or-nothing `posted`/`skipped`/`no-suggestions`/`blocked`/`failed` statuses for S04.
- **Formatter publisher idempotency gotcha:** the inbound `sanitizeContent` pipeline strips HTML comments; outgoing formatter review bodies intentionally use raw secret scanning plus targeted `sanitizeOutgoingMentions()` so `buildReviewOutputMarker(reviewOutputKey)` survives publication.
- **Combined formatter/review partial-failure contract:** formatter failures post/log bounded diagnostics without suppressing normal review publication/fallback; normal review result failures or thrown executor errors still attempt formatter suggestions when the workspace/config/PR identity are available, then preserve existing review error behavior.
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
- [ ] M066: Same-PR Formatter Suggestions
  - [x] S01: Formatter suggestion config and mention intent
  - [x] S02: Formatter command and diff-to-suggestion mapper
  - [x] S03: Batched same-PR suggestion review publisher
  - [x] S04: Explicit and combined request orchestration
  - [ ] S05: Live smoke proof and operator docs

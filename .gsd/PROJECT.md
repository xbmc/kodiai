# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, multi-model routing, and explicit mention-driven review handling.

Milestones M043, M044, M045, M046, M047, and **M051** are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, M045 turned contributor experience into one explicit cross-surface product contract, M046 turned contributor-tier calibration into a repeatable proof surface with an explicit replacement contract, M047 shipped that replacement rollout through the live review/runtime, Slack/profile, retrieval, identity, and milestone-close verification surfaces, and M051 closed the manual rereview truthfulness gap plus the remaining M048 operator/verifier proof-surface debt.

**M066 is active: Same-PR Formatter Suggestions.** S01, S02, S03, S04, and S05 are closed in the GSD roadmap. S06 has completed its task execution as a bounded live-smoke attempt, but it did **not** produce the required accepted same-PR formatter suggestion proof. The controlled PR #134 trigger proved authenticated operator access, PR-head smoke configuration, GitHub delivery/log correlation, and deterministic verifier behavior, but the deployed app handled `@kodiai format suggestions` as a generic conversational formatting request instead of entering the formatter-suggestion subflow. `docs/smoke/m066-formatter-suggestions.md` truthfully records the missing formatter `mention-format-suggestions` reviewOutputKey, missing Kodiai Pull Request Review, missing fenced suggestion comment, and failing verifier state. R077/R085 remain unvalidated until a future live run returns `m066_s05_ok`.

M066 delivered these staged contracts:

- **S01:** Default-off `review.formatterSuggestions` config plus explicit formatter-suggestion mention intents. `automatic` defaults false; explicit `@kodiai format suggestions` and `@kodiai suggest formatting fixes` stay allowed without automatic mode; `@kodiai review & format suggestions` carries a combined descriptor while preserving normal review routing.
- **S02:** Conservative formatter command execution and unified-diff-to-GitHub-suggestion mapping. Unsafe, unmappable, malformed, pure insertion/deletion, path-mismatched, and capped hunks become structured skips instead of guessed suggestions.
- **S03:** Batched same-PR Pull Request Review publication through `publishFormatterSuggestionReview()`, including idempotency markers, outgoing secret scanning, mention sanitization, and bounded failure statuses. It never falls back to branch pushes, new PRs, bot commits, issue comments, or standalone comments as a proof surface.
- **S04:** Runtime mention orchestration for explicit format-only and combined review-and-format requests. Format-only bypasses Claude and stays read-only; combined requests preserve normal review behavior while running formatter suggestions independently.
- **S05:** `verify:m066:s05`, operator docs, and the durable smoke artifact. The verifier requires a `mention-format-suggestions` review-output key, exactly one matching `COMMENTED` Pull Request Review on the encoded PR, and at least one associated inline review comment containing a fenced GitHub `suggestion` block. Missing GitHub App access and GitHub API failures surface as named bounded statuses without printing secrets.
- **S06:** Authenticated live-smoke retry on `xbmc/kodiai#134` with non-secret evidence. It resolved the initial missing-credentials blocker through the authenticated `gh` operator path, created a controlled PR with a one-hunk README formatter diff and PR-head formatter config, posted `@kodiai format suggestions`, captured delivery `9961ce70-4830-11f1-86fa-c01e4dffd5b0`, revision `ca-kodiai--deploy-20260504-081420`, ACA job `caj-kodiai-agent-3dzowdd`, and bounded decline evidence. It did not close the live-proof requirement because no formatter subflow fields, reviewOutputKey, same-PR Kodiai review, or fenced suggestion comment appeared.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Formatter-suggestion config seam:** `review.formatterSuggestions` in `src/execution/config.ts` controls automatic formatter-suggestion inclusion separately from explicit mention access. `automatic` defaults false and is reserved for future automatic-review inclusion until that path is wired and smoked; explicit mention requests are operationally documented separately.
- **Formatter-suggestion mention seam:** `src/handlers/formatter-suggestion-intent.ts` is the pure parser for explicit formatter-suggestion requests. `src/handlers/mention.ts` stores the parsed descriptor on `ExecutionContext.formatterSuggestionRequest` so downstream execution/publishing code should not re-parse mention text.
- **Formatter-suggestion orchestration seam:** `src/handlers/formatter-suggestion-orchestration.ts` composes formatter command execution, PR diff collection, commentability indexing, formatter diff mapping, head-SHA resolution, and batched same-PR review publication into a structured subflow result. Expected runtime failures are returned as bounded statuses and visible messages, not thrown exceptions.
- **Formatter-suggestion routing invariant:** format-only suggestions remain read-only, bypass Claude, and must not enter write mode; combined `review-and-format` requests preserve explicit review routing while letting the formatter subflow run independently after review work.
- **Formatter command runner seam:** `src/execution/formatter-suggestions.ts` owns formatter command execution. It accepts injected process execution for tests, uses workspace cwd for the default Bun-backed runner, reports `no-command`/`no-op`/`success`/`failed`/`timed-out`, substitutes only `{baseRef}`, `{headRef}`, and `{diffRange}`, and never stages, commits, pushes, or publishes by itself.
- **Formatter diff parser seam:** formatter stdout is parsed conservatively into file/hunk/line models with old/current and new/formatted cursor positions. Unsupported or malformed diff states are structured skips, not partial guesses.
- **Formatter suggestion mapping seam:** `buildPrDiffCommentabilityIndex()` records RIGHT-side PR diff target lines, and `mapFormatterDiffToSuggestions()` validates every formatter replacement target line before emitting S03-batchable GitHub suggestion payloads. Caps are enforced after safety validation so skipped/capped counts stay truthful.
- **Formatter suggestion publisher seam:** `publishFormatterSuggestionReview()` in `src/execution/formatter-suggestion-publisher.ts` consumes S02 payloads directly, uses `octokit.rest.pulls.createReview` with `event: "COMMENT"`, creates one same-PR Pull Request Review with batched inline suggestions, applies review-output idempotency gates, scans outgoing content for secrets, sanitizes configured bot handles, and reports all-or-nothing `posted`/`skipped`/`no-suggestions`/`blocked`/`failed` statuses.
- **Formatter publisher idempotency gotcha:** the inbound `sanitizeContent` pipeline strips HTML comments; outgoing formatter review bodies intentionally use raw secret scanning plus targeted `sanitizeOutgoingMentions()` so `buildReviewOutputMarker(reviewOutputKey)` survives publication.
- **Formatter live-proof verifier seam:** `scripts/verify-m066-s05.ts` is the M066 S05 proof gate. It validates arguments before network access, uses GitHub App credentials without printing secrets, scopes reads to the PR encoded by the key, rejects duplicate/wrong-state/wrong-surface evidence, and only accepts associated inline fenced suggestion comments on the same Pull Request Review.
- **M066 live-smoke gotcha:** PR-head `.kodiai.yml` formatter config is necessary for smoke PRs when `main` has no `review.formatterSuggestions.command`, because Kodiai loads repo config after checking out the PR head. Even with that config, proof is not accepted unless the deployed runtime emits a formatter `mention-format-suggestions` reviewOutputKey and GitHub accepts a same-PR suggestion review.
- **Combined formatter/review partial-failure contract:** formatter failures post/log bounded diagnostics without suppressing normal review publication/fallback; normal review result failures or thrown executor errors still attempt formatter suggestions when the workspace/config/PR identity are available, then preserve existing review error behavior.
- **Manual rereview contract:** `@kodiai review` is the only supported manual rereview trigger. Team-only `pull_request.review_requested` events — including `ai-review` / `aireview` — are retired as operator triggers and should surface only as skipped manual-trigger negatives.
- **Manual rereview observability seam:** explicit manual review proof comes from mention completion/publish evidence (`lane=interactive-review`, `taskType=review.full`, approval/fallback publish resolution), not from reviewer-team topology or self-generated open-event requests.
- **Self-event filter invariant:** `src/webhook/filters.ts` always drops app-originated events, so self-generated reviewer/team requests cannot be used as proof for human manual rereview behavior.
- **Phase-timing evidence seam:** `src/review-audit/phase-timing-evidence.ts` preserves matched correlated rows even when interpretation fields are missing, marks them as `invalid-phase-payload`, and leaves downstream verifiers enough evidence to diagnose malformed payload drift truthfully.
- **Shared M048 outcome-summary seam:** `scripts/verify-m048-s01.ts` owns tri-state phase-timing wording, while `verify:m048:s03` reuses that summary verbatim instead of rebuilding its own prose.
- **Timeout Review Details typing seam:** `TimeoutReviewDetailsProgress` in `src/lib/review-utils.ts` is the single source of truth for timeout progress formatting consumed by `src/handlers/review.ts`.
- **Contributor-experience contract seam:** `src/contributor/experience-contract.ts` separates contributor-signal provenance/coarseness from surface behavior so review prompt shaping, Review Details, retrieval hints, Slack profile output, and identity-link copy stay truthful and non-contradictory.
- **Persisted contributor trust seam:** `src/contributor/profile-trust.ts` and migration `037-contributor-profile-trust.sql` establish the versioned trust boundary between stored profile data and user-facing behavior.
- **Shared runtime review resolver:** `src/contributor/review-author-resolution.ts` centralizes trust-aware review classification and fail-open fallback precedence.
- **Stored-profile Slack/profile resolver:** `src/contributor/profile-surface-resolution.ts` is the downstream persisted-profile seam; only `profile-backed` projections may claim active linked guidance or fetch expertise.
- **Opted-out system-view identity suppression:** internal contributor lookups that need to distinguish opted-out from absent profiles must use `includeOptedOut: true` and keep opted-out outcomes generic.
- **Calibration fixture proof seam:** `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-snapshot.ts`, and `scripts/verify-m046-s01.ts` separate human-curated contributor truth from generated live evidence so calibration work can rerun against a stable xbmc corpus.
- **Calibration evaluator seam:** `src/contributor/calibration-evaluator.ts` compares the modeled live incremental path against the intended full-signal path, preserves retained/excluded cohort truth, and reports fidelity/degradation limits instead of fabricating replay evidence.
- **Calibration change-contract seam:** `src/contributor/calibration-change-contract.ts` converts calibration recommendations into explicit keep/change/replace mechanisms with evidence, impacted surfaces, and contradiction checks for downstream rollout work.
- **Composable proof harnesses:** milestone verifiers emit stable check IDs/status codes from normalized report objects so downstream slices and validators can consume them mechanically.
- **Verifier false-green defense:** milestone verifiers must fail on forbidden evidence reappearing, not just on required evidence disappearing. M066 S05 follows this by rejecting wrong actions, wrong repos, wrong delivery ids, duplicate reviews, wrong review states, issue-comment-only surfaces, and missing suggestion fences.
- **Explicit `not_applicable` handling:** when a scenario has no truthful surface, verifiers should emit `not_applicable` instead of inventing synthetic passing evidence.
- **Deploy/runtime proof surfaces:** `deploy.sh` prints the active ACA revision plus `/healthz` and `/readiness` URLs; operator runbooks and verifiers rely on structured publication evidence rather than ad hoc inspection.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping. M066 S06 did **not** validate R085/R077 live committability proof; those requirements still need an authenticated live smoke run and `m066_s05_ok` evidence before being marked validated.

## Milestone Sequence

- [x] M001–M042: MVP through contributor-tier truthfulness and mention-review production repair groundwork
- [x] M043: Restore Mention Review Publication and Reverify PR #80
- [x] M044: Audit Recent XBMC Review Correctness
- [x] M045: Contributor Experience Product Contract and Architecture
- [x] M046: Contributor Tier Calibration and Fixture Audit
- [x] M047: Contributor Experience Redesign and Calibration Rollout
- [x] M051: Manual rereview trigger truthfulness
- [ ] M066: Same-PR Formatter Suggestions
  - [x] S01: Formatter suggestion config and mention intent
  - [x] S02: Formatter command and diff-to-suggestion mapper
  - [x] S03: Batched same-PR suggestion review publisher
  - [x] S04: Explicit and combined request orchestration
  - [x] S05: Live-proof verifier, operator docs, and blocked smoke artifact
  - [ ] S06: Authenticated live-smoke retry produced bounded decline, not accepted same-PR formatter suggestion proof

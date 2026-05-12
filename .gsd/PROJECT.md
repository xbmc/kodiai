# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It receives GitHub webhooks and Slack events, runs agent executions in isolated Azure Container App jobs, and publishes structured results back to GitHub and Slack.

## Core Value

High-signal, truthful automated review on every PR. Findings land in GitHub with severity, confidence, suppression, reviewer context, and execution details, while the surrounding systems keep that review surface attributable, explainable, and operationally safe.

## Current State

The deployed review stack is in place: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant flows, write-mode execution, MCP/tool routing, knowledge/wiki workflows, contributor profiling, multi-model routing, explicit mention-driven review handling, explicit same-PR formatter suggestions, and the first shadow-only docs/config/runbook truthfulness specialist lane pilot.

Milestones M043, M044, M045, M046, M047, M051, M053, M066, and M069 are complete. M043 restored explicit `@kodiai review` publication in production, M044 packaged the recent-xbmc audit into the operator-facing `verify:m044` command and runbook, M045 turned contributor experience into one explicit cross-surface product contract, M046 turned contributor-tier calibration into a repeatable proof surface with an explicit replacement contract, M047 shipped that replacement rollout through the live review/runtime, Slack/profile, retrieval, identity, and milestone-close verification surfaces, M051 closed the manual rereview truthfulness gap plus the remaining M048 operator/verifier proof-surface debt, M053 shipped the same-PR formatter-suggestion milestone evidence set, M066 records the accepted live GitHub formatter-suggestion proof lineage, and M069 introduced the docs/config/runbook truthfulness specialist as a same-job shadow-only subflow with bounded evidence and no specialist-authored visible publication path.

**M069 is complete: Specialist Lane Pilot.** Operator-truth paths now trigger one `docs-config-truth` specialist lane in the review handler as a same-job, read-only, fail-open shadow subflow. The lane is represented by a typed local contract, deterministic path classifier, bounded output normalizer, private candidate/reducer metrics, compact Review Details/log/verifier projection, and a live-required proof gate. Specialist output stays private to aggregate status/count/metric/correlation evidence; it does not feed prompts, executor inputs, inline findings, issue comments, approvals, correctness/security claims, tier behavior, or any publication path. The final S05 live-required verifier targeted `xbmc/xbmc#28172` and truthfully returned `success:false`, `status_code:"m069_blocked_live_access"`, blocker `github_access_404;missing_correlation_key`, with no raw payload leakage and no visible specialist publication detected. That is accepted for M069 as blocked evidence under the roadmap criterion, not as production specialist success.

M069 delivered these staged contracts:

- **S01:** Pure `src/specialists/` shadow specialist contract for the `docs-config-truth` lane, deterministic docs/runbook/config/workflow/verifier/script path triggering, bounded skip/degraded reasons, candidate metric normalization, correlation fields, and local `verify:m069:s01` proof.
- **S02:** Real `createReviewHandler` injection seam invoking the specialist after diff context and before normal executor execution, with read-only input, timeout/error/malformed fail-open behavior, bounded private handler log/status fields, and local `verify:m069:s02` proof.
- **S03:** Private candidate/reducer metric projection with duplicate/disagreement/count/availability fields and publication-denial booleans, wired only into the private shadow-specialist handler seam with negative tests proving normal review remains the sole visible publisher.
- **S04:** Aggregate-only Review Details/log/verifier projection showing compact status, counts, metric availability, redaction, correlation, and publication denial while keeping raw candidates/prompts/model/tool payloads private; `verify:m069:s04` returns `m069_ok` only for local bounded fixture/static proof.
- **S05:** Live-required `verify:m069:s05` proof gate for `xbmc/xbmc#28172`, with injectable collectors for deterministic tests, real GitHub/Log Analytics collection by default, and `--allow-blocked` semantics that preserve blocked reports as `success:false` rather than operational success.

**M053 is complete: Same-PR Formatter Suggestions.** Explicit formatter-suggestion PR mentions are recognized, formatter command output is converted into safe GitHub suggestion payloads, suggestions publish as a same-PR Pull Request Review instead of a branch/PR/commit, combined `@kodiai review & format suggestions` requests run review and formatter subflows independently, unsafe/excessive hunks are skipped or capped with visible diagnostics, and live proof documentation ties the capability to accepted GitHub suggestion evidence on `xbmc/xbmc#28259`. The closeout verification reran the M053 integrated verifier, the full formatter contract/orchestration bundle (306 passing tests), the actual `scripts/verify-m066-s05.test.ts` verifier test, and the M053 smoke documentation marker check.

M053 delivered these staged contracts:

- **S01:** Default-off `review.formatterSuggestions` config plus explicit formatter-suggestion mention intents. `automatic` defaults false; explicit `@kodiai format suggestions` and `@kodiai suggest formatting fixes` stay allowed without automatic mode; `@kodiai review & format suggestions` carries a combined descriptor while preserving normal review routing.
- **S02:** Conservative formatter command execution and unified-diff-to-GitHub-suggestion mapping. Unsafe, unmappable, malformed, pure insertion/deletion, path-mismatched, and capped hunks become structured skips instead of guessed suggestions.
- **S03:** Batched same-PR Pull Request Review publication, including idempotency markers, bounded failure statuses, and no fallback to branch pushes, new PRs, bot commits, issue comments, or standalone comments as the formatter proof surface.
- **S04:** Runtime mention orchestration for explicit format-only and combined review-and-format requests. Format-only bypasses Claude and stays read-only; combined requests preserve normal review behavior while running formatter suggestions independently.
- **S05:** Live-proof documentation and verifier alignment. The accepted proof record includes explicit trigger/action, same-PR `COMMENTED` Pull Request Review, fenced `suggestion` comments, delivery/reviewOutputKey correlation, and `m066_s05_ok` verifier status. Fresh exact live rerun remains credential-gated, so closeout used the accepted proof record plus local verifier/contract tests.

The prior M066 project record also tracks the live-smoke lineage for this capability: the deployed Azure Container Apps revision `ca-kodiai--deploy-20260504-222417` handled a fresh authenticated formatter trigger on `xbmc/kodiai#134`, emitted a formatter `mention-format-suggestions` reviewOutputKey, published a same-PR COMMENTED Kodiai Pull Request Review with a fenced GitHub `suggestion` review comment, and `bun run verify:m066:s05` returned `success: true` with `status_code: "m066_s05_ok"`.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Shadow specialist contract seam:** `src/specialists/shadow-specialist.ts` owns the `docs-config-truth` lane identity, operator-truth path classification, bounded output normalization, candidate counts, metric availability, correlation keys, and redaction/publication-hazard diagnostics.
- **Shadow specialist handler seam:** `src/specialists/shadow-specialist-subflow.ts` and `src/handlers/review.ts` run the docs/config/runbook specialist as an injectable same-job read-only shadow subflow after changed-file/diff context is available and before normal review execution; timeout, error, malformed, skipped, and degraded states fail open.
- **Shadow specialist publication invariant:** Specialist output is shadow-only. It may produce private aggregate metrics and compact evidence lines, but it must not create or influence GitHub inline findings, standalone issue comments, approvals, Review Details candidate content, correctness/security claims, tier-mode behavior, or M068-bypassing publication paths.
- **Shadow specialist metric reducer seam:** `src/specialists/shadow-specialist-metrics.ts` projects normalized specialist output into bounded aggregate status/count/metric/correlation/publication-denial fields while excluding candidate bodies, fingerprints, raw prompts, model output, tool payloads, approval fields, and publication fields.
- **Shadow specialist evidence seam:** `src/specialists/shadow-specialist-review-details.ts`, `src/lib/review-utils.ts`, and the M069 verifier scripts expose aggregate-only Review Details/log/verifier evidence with compact status, count, metric availability, redaction, publication-denial, deliveryId, reviewOutputKey, and correlationKey fields.
- **Shadow specialist live-proof invariant:** `scripts/verify-m069-s05.ts` is the live-required gate for production-like specialist proof on `xbmc/xbmc#28172`. `--allow-blocked` may make a blocker report exit 0 for closeout capture, but blocked evidence remains `success:false` and cannot be counted as operational `m069_ok` proof.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, and `src/handlers/review-idempotency.ts` prevents duplicate publication.
- **Formatter-suggestion config seam:** `review.formatterSuggestions` in `src/execution/config.ts` controls automatic formatter-suggestion inclusion separately from explicit mention access. `automatic` defaults false and is reserved for future automatic-review inclusion until that path is wired and smoked; explicit mention requests remain available.
- **Formatter-suggestion mention seam:** `src/handlers/formatter-suggestion-intent.ts` is the pure parser for explicit formatter-suggestion requests. `src/handlers/mention.ts` stores the parsed descriptor on `ExecutionContext.formatterSuggestionRequest` so downstream execution/publishing code should not re-parse mention text.
- **Formatter mention review-output identity seam:** `src/handlers/mention.ts` owns the shared `mention-format-suggestions` action identity for explicit formatter mentions and passes it into the formatter subflow. Format-only and combined formatter completion logs include `deliveryId`, `reviewOutputKey`, and `reviewOutputAction` so deployed live-smoke failures can be distinguished from generic conversational handling.
- **Formatter-suggestion orchestration seam:** `src/handlers/formatter-suggestion-orchestration.ts` composes formatter command execution, PR diff collection, commentability indexing, formatter diff mapping, head-SHA resolution, and batched same-PR review publication into a structured subflow result. Expected runtime failures are returned as bounded statuses and visible messages, not thrown exceptions.
- **Formatter-suggestion routing invariant:** format-only suggestions remain read-only, bypass Claude, and must not enter write mode; combined `review-and-format` requests preserve explicit review routing while letting the formatter subflow run independently after review work.
- **Formatter command runner seam:** `src/execution/formatter-suggestions.ts` owns formatter command execution. It accepts injected process execution for tests, uses workspace cwd for the default Bun-backed runner, reports `no-command`/`no-op`/`success`/`failed`/`timed-out`, substitutes only allowlisted placeholders, and never stages, commits, pushes, or publishes by itself.
- **Formatter diff parser seam:** formatter stdout is parsed conservatively into file/hunk/line models with old/current and new/formatted cursor positions. Unsupported or malformed diff states are structured skips, not partial guesses.
- **Formatter suggestion mapping seam:** `buildPrDiffCommentabilityIndex()` records RIGHT-side PR diff target lines, and `mapFormatterDiffToSuggestions()` validates every formatter replacement target line before emitting GitHub suggestion payloads. Caps are enforced after safety validation so skipped/capped counts stay truthful.
- **Formatter suggestion publisher seam:** `publishFormatterSuggestionReview()` in `src/execution/formatter-suggestion-publisher.ts` consumes mapped payloads, uses `octokit.rest.pulls.createReview` with `event: "COMMENT"`, creates one same-PR Pull Request Review with batched inline suggestions, applies review-output idempotency gates, scans outgoing content for secrets, sanitizes configured bot handles, and reports all-or-nothing publication statuses.
- **Formatter publisher idempotency gotcha:** the inbound `sanitizeContent` pipeline strips HTML comments; outgoing formatter review bodies intentionally use raw secret scanning plus targeted mention sanitization so review-output markers survive publication.
- **Formatter live-proof verifier seam:** `scripts/verify-m066-s05.ts` is the proof gate for accepted formatter suggestions. It validates arguments before network access, uses GitHub App credentials without printing secrets, scopes reads to the PR encoded by the key, rejects duplicate/wrong-state/wrong-surface evidence, and only accepts associated inline fenced suggestion comments on the same Pull Request Review.
- **Combined formatter/review partial-failure contract:** formatter failures post/log bounded diagnostics without suppressing normal review publication/fallback; normal review result failures or thrown executor errors still attempt formatter suggestions when the workspace/config/PR identity are available, then preserve existing review error behavior.
- **Boundary Map closeout gotcha:** M053 and M069 roadmaps rendered duplicate `## Boundary Map` headings. Closeout proved integration from slice SUMMARY `provides`/`requires` and validation evidence, but future milestones should fix the planning/rendering source before relying on roadmap boundary maps.
- **Manual rereview contract:** `@kodiai review` is the only supported manual rereview trigger. Team-only `pull_request.review_requested` events — including `ai-review` / `aireview` — are retired as operator triggers and should surface only as skipped manual-trigger negatives.
- **Manual rereview observability seam:** explicit manual review proof comes from mention completion/publish evidence (`lane=interactive-review`, `taskType=review.full`, approval/fallback publish resolution), not from reviewer-team topology or self-generated open-event requests.
- **Self-event filter invariant:** `src/webhook/filters.ts` always drops app-originated events, so self-generated reviewer/team requests cannot be used as proof for human manual rereview behavior.
- **Contributor-experience contract seam:** `src/contributor/experience-contract.ts` separates contributor-signal provenance/coarseness from surface behavior so review prompt shaping, Review Details, retrieval hints, Slack profile output, and identity-link copy stay truthful and non-contradictory.
- **Composable proof harnesses:** milestone verifiers emit stable check IDs/status codes from normalized report objects so downstream slices and validators can consume them mechanically.
- **Verifier false-green defense:** milestone verifiers must fail on forbidden evidence reappearing, not just on required evidence disappearing. The formatter live-proof verifier rejects wrong actions, wrong repos, wrong delivery ids, duplicate reviews, wrong review states, issue-comment-only surfaces, and missing suggestion fences; the M069 specialist verifier rejects visible specialist publication, raw leakage, wrong target, missing correlation, skipped/degraded shadow evidence, and live-access blockers misclassified as success.
- **Deploy/runtime proof surfaces:** `deploy.sh` prints the active ACA revision plus `/healthz` and `/readiness` URLs; operator runbooks and verifiers rely on structured publication evidence rather than ad hoc inspection.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping. M053 validates the explicit formatter-suggestion requirements R076–R085 with contract/integration tests and accepted live-proof documentation. R086 remains deferred for a future explicit opt-in automatic-mode runtime proof. R087 remains deferred for future adapter expansion. R089–R091 remain out of scope as negative constraints that the formatter implementation does not depend on Jenkins artifacts, create separate formatting PRs, or push formatter commits directly. M069 advances R102 and R105 with a shadow-only docs/config/runbook specialist lane, bounded candidate/reducer metrics, and proof surfaces; keeps R103 conflict semantics deferred to M070+; and covers R117 by proving the specialist lane cannot publish visible findings or bypass the candidate-approved publication boundary. Production specialist success and tier graduation remain blocked/deferred until `verify:m069:s05` returns `m069_ok` on exact live evidence.

## Milestone Sequence

- [x] M001–M042: MVP through contributor-tier truthfulness and mention-review production repair groundwork
- [x] M043: Restore Mention Review Publication and Reverify PR #80
- [x] M044: Audit Recent XBMC Review Correctness
- [x] M045: Contributor Experience Product Contract and Architecture
- [x] M046: Contributor Tier Calibration and Fixture Audit
- [x] M047: Contributor Experience Redesign and Calibration Rollout
- [x] M051: Manual rereview trigger truthfulness
- [x] M053: Same-PR Formatter Suggestions
  - [x] S01: Formatter suggestion config and mention intent
  - [x] S02: Formatter command and diff-to-suggestion mapper
  - [x] S03: Batched same-PR suggestion review publisher
  - [x] S04: Explicit and combined request orchestration
  - [x] S05: Live proof documentation and verifier alignment
- [x] M066: Same-PR Formatter Suggestions live-smoke lineage
  - [x] S01: Formatter suggestion config and mention intent
  - [x] S02: Formatter command and diff-to-suggestion mapper
  - [x] S03: Batched same-PR suggestion review publisher
  - [x] S04: Explicit and combined request orchestration
  - [x] S05: Live-proof verifier, operator docs, and first smoke artifact
  - [x] S06: Authenticated live-smoke retry produced bounded decline evidence for the deployed formatter trigger miss
  - [x] S07: Deployed formatter-routing remediation and accepted live same-PR suggestion proof
- [x] M069: Specialist Lane Pilot
  - [x] S01: Shadow specialist contract and operator-truth trigger
  - [x] S02: Same-job read-only specialist subflow
  - [x] S03: Candidate and reducer metric path without visible publication
  - [x] S04: Compact Review Details, structured logs, and verifier contract
  - [x] S05: Production-like specialist proof or truthful live-access blocker classification

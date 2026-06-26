# Changelog

All notable changes to this project are documented in this file.

## v0.46 (2026-06-26)

Review/deployment reliability hardening after optimizer and thermo-nuclear quality passes, deployed to Azure Container Apps and validated against the live Kodi review trigger path.

### Added

- Optimizer indexes and paired rollback migration for review graph, review-comment retrieval, wiki linkshere, and dependency-bump history paths.
- Internal MCP auth fallback module and coverage for query-token compatibility on callback surfaces.
- Regression coverage for per-page PR file retry, cluster candidate lookup concurrency, safe regex suppression patterns, wiki replacement fallback, and dependency-bump enrichment.

### Changed

- PR file fetching now goes through one paginated helper with retry at the helper boundary, including addon checks, review/mention fallbacks, wiki staleness detection, dependency-bump merge history, and the PR-evidence backfill script.
- Cluster matching no longer exposes a fake store-level batch method; bounded nearest-candidate lookup concurrency now lives in the pipeline.
- Review, retrieval, wiki, and dependency-bump paths reduce repeated work and narrow transient-retry boundaries.

### Fixed

- Quantified regex alternations without prefix overlap are no longer rejected by the suppression matcher.
- Wiki sync fallback replacement no longer carries unused state.
- Review execution paths retain the MCP query-token fallback needed by deployed callback clients.

### Verification

- `bunx tsc --noEmit` passed.
- `bun run lint` passed.
- `bun run test:unit` passed with `5684 pass`.
- Push CI for `e1c4e03159` passed.
- Deployed revision `ca-kodiai--deploy-e1c4e03159e6-20260626-001905` passed `/healthz` and `/readiness`.
- Live explicit `@kodiai review` trigger was posted on `xbmc/xbmc#28172` in comment `4807535661`.

## v0.45 (2026-06-25)

MCP callback reliability, mention grounding, wiki sync recovery, and review-publication hardening — found by reviewing production logs and validated live on Kodi PRs.

### Added

- Orchestrator MCP request timeout guard: each internal MCP callback fast-fails with a retryable `503` (plus structured `mcp-http-request-timeout` / `mcp-http-request-slow` logs) instead of hanging until the Azure Container Apps ingress 240s stream-idle timeout silently resets it.
- Agent-side bounded retry (exponential backoff + full jitter) for MCP callbacks, gated to idempotent / dedup-guarded servers so a retry can never duplicate a PR comment.
- Shared `withTimeout` timeout primitive, and a drift-guard test that the retry-safe MCP server allowlist only names servers the factory actually produces.

### Changed

- Orchestrator container resources are now explicit and configurable, defaulting to 2 vCPU / 4Gi (previously the implicit 0.5 vCPU / 1Gi), so review-time CPU bursts no longer starve the single-threaded event loop and strand in-flight MCP callbacks.
- Restored review guidance that was over-compressed in v0.43: findings explain the mechanism (impact + the condition that triggers it + `file:line`) instead of bare labels, and summary `### Impact` lines are self-contained `[SEVERITY] file (line): mechanism`.
- The retry-safe MCP server policy is co-located with the server factory definitions rather than duplicated in the agent entrypoint.

### Fixed

- Mention context bleed: a vague `@kodiai` follow-up on a PR no longer pulls an unrelated repository issue into the reply. The issue corpus is suppressed for PR-surface mentions, and PR mentions are grounded in the PR diff.
- Wiki incremental sync stall: non-page `recentchanges` entries (pageid 0) are skipped before the parse call, so one unparseable entry no longer fails every sync cycle and pins the checkpoint — which had left the wiki index going stale.
- Degraded explicit-review fallback no longer discards the review: when structured finding lines cannot be parsed from the result text, it surfaces the agent's actual review text instead of a generic "not safely publishable" message.

### Verification

- `bunx tsc --noEmit` passed.
- `bun run lint` passed.
- `bun run test:unit` passed with `5669 pass`.

## v0.44 (2026-06-18)

Review-publication reliability, public fallback hardening, and live Kodi review validation.

### Added

- GitHub rate-limit retries around fallback/error comment publication, including usage-limit duplicate scans, tracked updates, duplicate updates, and create-comment fallback paths.
- Regression coverage for retrying GitHub `429` and secondary-rate-limit `403` responses while keeping normal permission `403` failures non-retryable.
- Regression coverage that public error comments stay bounded and do not expose executor, API, workspace, token, or remote diagnostic details.

### Changed

- Review Details now omits internal operational diagnostics from ordinary public output while retaining bounded diagnostics where they are explicitly relevant.
- Mention and review fallback wording now stays user-facing and bounded for execution errors, turn-limit exits, and publish-failure paths.
- Public error headers and usage-limit wording now refer to the review provider generically instead of leaking raw provider/runtime failure text.

### Verification

- `bunx tsc --noEmit` passed.
- `bun run lint` passed.
- `bun run test:unit` passed with `5643 pass`.
- Deployed revision `ca-kodiai--deploy-0122db7db467-20260618-100027` passed `/healthz` and `/readiness`.
- Live explicit `@kodiai review` proof on `xbmc/inputstream.adaptive#2060` completed ACA job `caj-kodiai-agent-ktzokve` and published bot output in comment `4744358392`.
- Live explicit `@kodiai review` proof on `xbmc/xbmc#28172` completed ACA job `caj-kodiai-agent-kdcpc4t`, published summary comment `4744422253`, and published four inline review comments.

## v0.43 (2026-06-08)

Token-usage optimization, embedding/batch resilience, and deployed live-review verification.

### Added

- Shared JSONB batch helpers and optimizer indexes for lower-query knowledge-store writes.
- Embedding batching and vector validation utilities with focused coverage for empty, malformed, and dimension-mismatched vectors.
- Sliding-window rate limiter and bounded concurrency helpers for mention/review utility paths.
- Focused retry helpers for transient database failures and `Retry-After` handling.

### Changed

- Review, mention, CI-failure, feedback-sync, and review-comment-sync paths reduce duplicated token/context work and delegate more shared behavior to focused modules.
- Knowledge-store, wiki-store, review-graph, cluster, and snippet persistence paths batch more writes and retry transient connection-ended failures.
- Guardrail LLM claim classification and shadow specialist diff snippets now use bounded, deduplicated inputs.
- Docker app and agent images pin Bun through the deploy path and remove the unused package-manager surface.

### Verification

- PR #185, #186, #187, and #188 merged to `main`.
- PR #188 CI passed.
- Local focused tests passed with 67 tests across retry-after, wiki publisher, and issue MCP server coverage.
- `bun run lint` passed.
- Deployed revision `ca-kodiai--deploy-5e2c60c391d1-20260608-092015` passed `/healthz` and `/readiness`.
- Live explicit `@kodiai review` proof on `xbmc/xbmc#28172` published bot output in comment `4651094791`.

## v0.42 (2026-06-01)

Review utility decomposition, mention state extraction, and Review Details boundary hardening.

### Added

- Review Details architecture gate for keeping formatting and publication-detail helpers out of the main review handler.
- Focused formatting modules for Review Details phases, validation, candidate publication, verification, and shared summary rendering.
- Mention state store utilities and shared review git/trigger/rate-limit helpers with module tests.

### Changed

- `review.ts` and `mention.ts` delegate more reducer, candidate, git-line, trigger, and publication-detail work to shared modules.
- Review utility boundaries were split into smaller files for finding metadata, profile presets, merge-confidence formatting, git helpers, and search rate limiting.
- Candidate publication bridge details now flow through the review orchestration boundary instead of staying embedded in the handler closure.

### Verification

- PR #182, #183, and #184 CI passed.
- Deployed revision `ca-kodiai--deploy-94c668222c20-20260601-133420` passed `/healthz`.
- Live explicit `@kodiai review` proof on `xbmc/xbmc#28172` completed through ACA agent execution `caj-kodiai-agent-alqjy8n` and published bot output in comment `4596332933`.

## v0.41 (2026-05-31)

Review handler slice extraction and formatter argv sandbox.

### Added

- Extracted review candidate publication runtime logging into `review-orchestration/review-candidate-publication-log.ts` with unit tests.
- Extracted continuation-family state persistence and publish-rights gating into `review-orchestration/review-continuation-family-state.ts` with unit tests.
- Formatter command sandbox: allowlisted executables spawn via argv; shell metacharacters or unknown binaries fall back to `bash -lc` with bounded `executionMode` telemetry.

### Changed

- `review.ts` delegates publication logging and continuation-family wiring to the new orchestration modules (~220 lines removed from the handler).

### Verification

- PR #181 CI passed.
- `bun run lint` passed.
- `bun run verify:m075 -- --json` passed with `statusCode=m075_ok`.
- Deployed revision `ca-kodiai--deploy-7d55f9108031-20260531-124116` passed `/healthz`, `/readiness`, and live `verify:m075` with `statusCode=m075_ok`.

## v0.40 (2026-05-31)

Priority-stack hardening for production observability, module boundaries, and runtime safety.

### Added

- Shared production-log projection module with unit tests for addon-check, review-timeout, candidate publication, and migration labels.
- Extracted review-timeout classification logging and fatal shutdown handler registration for testability.
- Operator trust-model runbooks for repo-controlled formatter shell execution and MCP ingress (`docs/runbooks/mcp-ingress-trust.md`).

### Changed

- Addon-check per-finding detail moved to debug logs with production-safe `severity` bindings (no addon IDs or `ERROR`/`WARN` tokens at info level).
- Structured classification logs now emit `gateResult` only (removed duplicate `classification` field).
- Fatal `uncaughtException` / `unhandledRejection` handlers trigger graceful shutdown instead of log-and-continue.
- Malformed signed GitHub webhook JSON returns HTTP 400 before dispatch.
- `review-idempotency` moved from `handlers/` to `review-orchestration/`.

### Verification

- PR #180 CI passed.
- `bun run lint` passed.
- `bun run verify:m075 -- --json` passed with `statusCode=m075_ok`.
- Deployed revision `ca-kodiai--deploy-da01ecc5f90a-20260531-113953` passed `/healthz`, `/readiness`, and live `verify:m075` with `statusCode=m075_ok`.

## v0.39 (2026-05-30)

Production log cleanup and M075 review-publication evidence.

### Added

- M075 production-log taxonomy and aggregate verifier coverage for candidate publication, review timeout classification, addon-check classification, and bounded live Log Analytics proof.
- Review candidate publication details now include publishable, nonPublishable, and fixBlocked counts, plus bounded outcome buckets and moved-to-details evidence.
- Approved non-commentable review candidates can be preserved as bounded Review Details findings without publishing unsafe inline comments.
- Addon-check and review-timeout outcomes now emit structured bounded classifications so expected policy/runtime outcomes are distinguishable from actionable failures.

### Changed

- Expected candidate-publication policy blocks now log at info level instead of warning level.
- Missing-replacement candidates stay private and are not projected into public details-only findings.
- Production startup migration logs use structured application logging, and logger error serialization strips request/response URL objects and stacks.
- Benign zero-count lifecycle and webhook dispatch fields are omitted from production logs to avoid misleading `failed:0` / `rejected:0` matches.
- Missing or stale MCP bearer-token requests are treated as bounded info-level auth lifecycle noise instead of production warnings.

### Verification

- PR #179 CI passed.
- Local focused release verification passed with `478 pass`.
- `bun run lint` passed.
- `bun run verify:m075 -- --json` passed with `statusCode=m075_ok`.
- Deployed revision `ca-kodiai--deploy-3d87f3900128-20260529-175246` passed `/healthz`, `/readiness`, and live `verify:m075` with `statusCode=m075_ok`.
- Production log audit for the deployed revision showed 0 Pino errors, 0 Pino warnings, 0 textual error matches, 0 textual warning matches, and 0 MCP unauthorized warnings.
- Live explicit `@kodiai review` proof on `xbmc/xbmc#28172` completed on `lane=interactive-review`, `taskType=review.full`, recorded 4 candidate findings, projected lifecycle and validation-truth evidence, and published bot output in comment `4581392154`.

## v0.38 (2026-05-19)

Review-budget reliability, validation-truth evidence, and deploy base-image hardening.

### Added

- Review prompt-section budgeting now records baseline-linked, new, trimmed, and bypassed section outcomes so operators can see what review context was preserved or reduced.
- Review cache telemetry now records hit, miss, degraded, bypass, and bookkeeping-error outcomes for mention/review context reuse.
- Continuation compaction now preserves checkpoint deltas, reused checkpoint counts, omitted scope counts, and fallback/degraded/bypass outcomes for bounded retry flows.
- Review Details now includes bounded same-PR finding lifecycle and validation-truth projections without exposing raw prompts, model output, candidate bodies, tool payloads, diffs, or secret-like strings.
- Repository doctrine config now has typed contracts and bounded ReviewPlan/Review Details projections so repo-specific review instructions are visible without leaking raw doctrine payloads.

### Changed

- Explicit `@kodiai review` runs now emit machine-checkable lifecycle and validation-truth evidence for detected, open, suggested, validated, revalidated, resolved, blocked, and degraded finding states.
- Candidate publication and same-PR fix eligibility now feed validation-truth evidence so Review Details can distinguish suggested-but-unvalidated findings from validated or revalidated outcomes.
- Deploys now mirror the Bun base image into ACR and build app/job images from that ACR mirror, avoiding Docker Hub anonymous pull limits during Azure remote builds. Optional Docker Hub credentials may be supplied for the import step.

### Verification

- PR #174 CI passed.
- Local deploy-script regression passed with `bun test scripts/deploy.test.ts` and `bash -n deploy.sh`.
- Deployed revision `ca-kodiai--deploy-20260519-125410` passed `/healthz` and `/readiness`.
- Live explicit `@kodiai review` proof on `xbmc/xbmc#28172` ran on `lane=interactive-review`, `taskType=review.full`, used repo inspection tools, completed ACA job `caj-kodiai-agent-28yydul`, and published real findings in comment `4491652552`.

## v0.37 (2026-05-05)

Same-PR formatter suggestions.

### Added

- Explicit formatter suggestions now run by default for `@kodiai format suggestions`, `@kodiai suggest formatting fixes`, and combined `@kodiai review format suggestions` / `@kodiai review & format suggestions` requests.
- The default formatter command is `git clang-format --diff origin/{baseRef} HEAD`; repositories may override `review.formatterSuggestions.command` for other formatter tooling while `review.formatterSuggestions.automatic` remains `false` by default.
- Container images now include `clang-format`, providing `git-clang-format` for the default explicit formatter-suggestion path.
- Live proof on `xbmc/xbmc#28259` passed `verify:m066:s05` with `status_code: "m066_s05_ok"` and GitHub accepted same-PR fenced suggestion comments.

### Fixed

- Natural trigger wording `@kodiai review format suggestions` now routes to the combined review-and-format path.
- Diff-style formatter commands that emit valid unified diff stdout with a nonzero exit code are treated as successful formatter output instead of command failures.

## v0.36 (2026-04-30)

Production log failure cleanup and operational hardening.

### Changed

- Migrated `learning_memories.finding_id` to `BIGINT` so GitHub review comment IDs above the 32-bit integer range can be stored safely.
- Added rollback protection for the `finding_id` down migration so operators get a clear failure before unsafe downcasting.
- Normalized learning-memory ID fields returned from PostgreSQL as `number`, `string`, or `bigint`, with safe-integer guards to avoid precision loss.
- Downgraded Slack `users.list` `missing_scope` identity-suggestion failures into token-scoped info-level disabled diagnostics.
- Bounded the Slack disabled-token cache to avoid unbounded process growth during token rotation or multi-token operation.
- Downgraded GitHub reaction-read permission denials into info-level skipped diagnostics.

### Verification

- CI passed on PR #121.
- Kodiai current-head review approved with no findings.
- Deployed revision `ca-kodiai--deploy-20260429-205210` passed `/healthz` and `/readiness`.

## v0.35 (2026-04-29)

Small-diff review fast path and agent runtime diagnostics.

### Fixed

- Routed tiny PR reviews through a dedicated `review.small-diff` fast path for both automatic reviews and explicit `@kodiai review` mentions.
- Capped small-diff reviews at 8 turns with a constrained diff-focused tool surface to avoid max-turn exhaustion on trivial PRs.
- Added a small-diff prompt scope contract that tells the reviewer to inspect the diff first and avoid broad repository exploration.
- Added per-turn tool target diagnostics to agent runtime logs for future max-turn/tool-loop debugging.
- Hardened routing line-count fallback so automatic and explicit review paths use consistent diff-vs-PR API line totals.
- Cleaned tiny-diff max-turn fallback messaging so users are not told to narrow an already tiny review.

### Verification

- Deployed to Azure Container Apps revision `ca-kodiai--deploy-20260429-174526`.
- `/healthz` returned `{"status":"ok","db":"connected"}` and `/readiness` returned `{"status":"ready"}`.
- PR #120 CI passed.

## v0.34 (2026-04-28)

Slack webhook replay safety rails and approval visibility.

### Changed

- Queued Slack webhook replay now routes through the same Slack v1 safety rails as live Slack events before invoking the assistant.
- Startup replay shares Slack thread-session state across queued entries so a replayed bootstrap can authorize a later queued thread follow-up.
- Queued GitHub and Slack replay bodies now fail closed on malformed JSON instead of crashing the startup replay loop.
- Startup replay validates queue entry IDs before marking completion/failure and avoids duplicate ignored-replay logging.
- Replay-time GitHub installation IDs are normalized before dispatch so malformed values fall back to the existing legacy sentinel.
- Approval review output now shows `Decision: APPROVE` above the collapsed `Kodiai response` details block for future deployed approvals.

### Verification

- PR #119 CI passed on head `4d43ad58651140d7eea4981194dd3b04e21dcb6d`.
- Local focused verification passed for webhook replay, Slack/webhook/comment/idempotency/prompt suites, typecheck, diff check, and lint.
- Deployed revision `ca-kodiai--deploy-20260428-004129` passed `/healthz` and `/readiness`.

## v0.33 (2026-04-27)

Review reliability, canonical Review Details publication, planning-artifact repair, and deployment hardening.

### Added

- First-pass changed-file triage guidance now asks review agents to rank files by risk before deep inspection so bounded runs preserve the most important coverage.
- Early review checkpoint instructions now require a planning checkpoint before deep inspection and periodic checkpoint updates during long reviews.
- M065 verifier coverage now rejects malformed nested verifier report contracts instead of silently accepting bad scalar shapes.

### Fixed

- Max-turn review exhaustion now flows through bounded first-pass / reduced-scope continuation handling instead of posting terminal manual-rerun fallback text.
- Review Details now merge into the canonical visible surface, including approval reviews, instead of creating stale standalone details comments when a pull-review surface already exists.
- Comment-cap Review Details now distinguish analysis scope from publication caps and report omitted lower-priority findings with correct singular/plural wording.
- Wiki cleanup tooling now targets only unmarked `kodiai[bot]` comments and treats missing/null GitHub authors as non-bot comments.
- Cluster scheduler tests no longer leak Bun module mocks into cluster-store tests.

### Changed

- M054 planning artifacts were repaired and queued milestone state was reduced to current, supported surfaces.
- M065 malformed nested-report test seams now accept `unknown` and let production validators reject bad payloads rather than using misleading `as never` fixtures.
- Deployment YAML quoting is hardened so generated Container Apps YAML preserves env values safely.

### Operational proof

- Deployed `main` at `c9de0f3f9265b6c272abda249c31d0e525f0a4d7` to Azure Container Apps.
- Post-deploy health returned `{"status":"ok","db":"connected"}` and readiness returned `{"status":"ready"}`.
- Live `@kodiai review` smoke on `xbmc/xbmc#28172` completed on `lane=interactive-review`, `taskType=review.full`, `publishResolution=executor`, `stopReason=end_turn`, and published review output.

## v0.32 (2026-04-25)

Release/docs pass for bounded review flow and production secret contract clarification.

### Added

- Release notes for the bounded review-flow work on `main`: prompt budgeting, continuation-state verifier coverage, and retry-settlement diagnostics.

### Changed

- README now distinguishes local `.env` / deploy input from the production Azure Container Apps runtime secret contract.
- Deployment docs now treat the Azure Container Apps secret set as the production source of truth and describe how the app consumes those values through secret references.
- Graceful restart docs now describe deploy input vs production runtime secrets using the same contract language as the deployment guide.

## v0.31 (2026-04-21)

Top-level documentation truth pass.

### Added

- README coverage for M051 manual rereview, M052 Slack webhook relay, M053 `new Function()` removal via `verify:m053`, and M054 verifier repair via `verify:m054:s01` / `verify:m054:s04`.

### Changed

- Top-level docs now describe nightly workflow surfaces and retain the post-v0.29 release chain expected by the documentation verifiers.

## v0.30 (2026-04-19)

Truthful Manual Rereview & Slack Webhook Relay.

### Added

- Verified webhook-to-Slack relay support via `POST /webhooks/slack/relay/:sourceId`, including env-backed `SLACK_WEBHOOK_RELAY_SOURCES` source config, generic payload normalization, optional filtering, explicit suppression/delivery failure outcomes, a dedicated relay runbook, and a fixture-backed `verify:m052` proof command.
- Operator smoke and rollout guidance for the relay surface, including documented curl flows for accepted, suppressed, and failed-delivery outcomes.

### Fixed

- `@kodiai review` is now the only supported manual rereview trigger; the stale `ai-review` / `aireview` team-trigger contract was removed from runtime behavior, config surfaces, docs, examples, and regression tests.
- Manual rereview observability now treats team-only `pull_request.review_requested` deliveries as explicit unsupported skip signals instead of implying a supported operator retrigger path.
- M048 phase-timing evidence handling now marks incomplete correlated phase rows as `invalid-phase-payload` and preserves `publication unknown` wording instead of collapsing partial evidence into false-green summaries.

### Changed

- README and deployment/runbook docs now describe Slack webhook relay as service-level runtime configuration rather than `.kodiai.yml` behavior.
- Review-request debugging and release-proof docs now point operators at the explicit `interactive-review` / `review.full` surfaces for supported manual rereview evidence.

## v0.29 (2026-04-15)

Explicit Review Lane Hardening.

### Fixed

- Explicit `@kodiai review` requests now run on a dedicated `interactive-review` lane so stale automatic review work on the same installation no longer starves manual review requests.
- Automatic review diff collection now bounds risky shallow-history recovery and degrades to GitHub PR file-list fallback instead of wedging the review lane on long-running merge-base recovery.
- Explicit mention-review prompt diff construction now uses bounded PR diff collection instead of the unsafe `origin/<base>..HEAD` fallback, preventing unrelated upstream files from inflating shallow-clone review prompts.
- Clean approval reviews are collapsed again: APPROVE review bodies now publish inside `<details>` wrappers across the shared approval builder, mention prompt contract, MCP comment server, and audit/verifier surfaces.

### Changed

- `src/execution/mcp/comment-server.ts` now normalizes clean approval bodies into the collapsed contract before publishing, so older visible-body variants do not leak into GitHub reviews.
- Review-output audit/verifier surfaces now validate the collapsed clean-approval contract (`details_wrapper=true`) instead of the short-lived visible-body exception.
- README and release history now reflect the explicit review lane, bounded diff fallback, and collapsed approval-body behavior shipped in this release.

## v0.28 (2026-04-12)

Explicit Review Publication Recovery.

### Fixed

- Explicit `@kodiai review` requests now run with the full review-class turn budget and tool surface instead of the reduced conversational mention budget, restoring truthful approval publication on large PRs.
- Clean-database CI runs now bootstrap the `KnowledgeStore` schema in `src/knowledge/store.test.ts`, removing the warm-schema false green that masked missing migrations.
- Deploys now force a fresh ACA revision when the template would otherwise reuse the existing revision name, preventing "successful deploy, no new revision" ambiguity.

### Changed

- `deploy.sh` now reports the live ACA revision after deploy so operator proof can tie health checks, logs, and publish evidence to the exact running revision.
- Deployment and review-request runbooks now document the explicit review publication path and its post-deploy proof surfaces.

## v0.27 (2026-04-06)

Contributor Tier Truthfulness.

### Added

- Shared percentile tier-calculation helpers in `src/contributor/tier-calculator.ts` plus scorer-side recalculation hooks used by incremental expertise updates
- Deterministic proof harnesses `verify:m042:s01`, `verify:m042:s02`, and `verify:m042:s03` covering persisted-tier advancement, review-surface truthfulness, and cache/fallback hardening
- Explicit `Author tier:` Review Details rendering and full-body regression coverage with required/banned phrase assertions for established and senior contributor guidance
- Warning surface for invalid cached author tiers so malformed lower-fidelity cache data is observable without blocking reviews

### Changed

- Contributor score updates now recalculate and persist truthful contributor tiers when overall scores advance instead of persisting stale stored tiers
- Review author-tier resolution now follows explicit precedence: contributor profile → bounded author cache → fallback classifier
- Prompt and Review Details surfaces now render truthful developing/established/senior guidance from the resolved contributor tier, including the CrystalP-shaped repro path
- `author_cache` reuse is now bounded to fallback-taxonomy values only (`first-time`, `regular`, `core`); unsupported cached values are ignored fail-open rather than trusted as richer contributor knowledge
- Degraded fallback review paths preserve the resolved author tier and include the exact Search API disclosure sentence without contradicting contributor guidance

## v0.26 (2026-04-05)

Structural Impact Evidence.

### Added

- Review-time structural-impact consumer layer combining persisted graph blast-radius data with canonical current-code retrieval through explicit `GraphAdapter` / `CorpusAdapter` seams
- Bounded `StructuralImpactPayload` contract with callers, impacted files, likely tests, graph coverage stats, canonical unchanged-code evidence, and explicit degradation records
- Structural Impact subsection in Review Details with hard caps, rendered/truncated counts, and truthful confidence wording
- `## Structural Impact Evidence` prompt section and evidence-backed breaking-change guidance for C++ and Python reviews
- Handler-level structural-impact cache with stable `(repo, baseSha, headSha)` keys, 256-entry LRU, and 10-minute TTL
- Centralized degradation summarizer producing machine-readable truthfulness signals (`graph-unavailable`, `corpus-unavailable`, `no-structural-evidence`, etc.)
- Deterministic proof harnesses `verify:m038:s02` and `verify:m038:s03` covering rendering, cache reuse, timeout fail-open, substrate-failure truthfulness, and asymmetric partial-degradation cases

### Changed

- Review flow now consumes the bounded structural-impact layer instead of reaching into substrate-native graph types directly
- Architecture and deployment docs updated to reflect Azure Container App job execution, canonical current-code corpus, and the six-corpus retrieval stack
- README updated to describe the Structural Impact feature and current retrieval/runtime shape

## v0.25 (2026-03-07)

Wiki Content Updates.

### Added

- Wiki embeddings migrated to voyage-context-3 with per-corpus model routing in retrieval pipeline
- Page popularity scoring combining MediaWiki inbound links, retrieval citation frequency, and edit recency
- Enhanced staleness detection grounded in actual PR/commit diffs from last 90 days
- LLM-generated section-level update suggestions with PR/commit citations and grounding verification
- Update suggestions published as tracking issue comments on xbmc/wiki with rate-limit safety
- Voice-preserving generation with spread sampling, style caching, template/heading validation
- Unified anti-hallucination guardrail pipeline across all output surfaces with context-grounded classification, LLM fallback, and audit logging

## v0.24.1 (2026-03-03)

Post-milestone fixes.

### Added

- Windows package list parser for dependency bump enrichment — extracts old/new versions from `0_package.target-*.list` diffs (e.g. `zlib-1.3.1-x64` → `zlib-1.3.2-x64`)
- `.list` file fallback in depends review pipeline — populates version diffs when no VERSION file exists
- PR-surface patch intent detection — when a user asks to "create a patch" for an earlier suggestion, Kodiai triggers write mode to open a PR with the changes applied

## v0.24 (2026-03-03)

Hallucination Prevention & Fact Verification.

### Added

- Epistemic boundary system with 3-tier knowledge classification (diff-visible, context-visible, external) in review prompts
- Cross-surface guardrails applied consistently to PR reviews, @mention responses, and Slack assistant
- Heuristic claim classifier labeling each finding's claims as diff-grounded, external-knowledge, or inferential
- Severity demotion capping external-knowledge findings at medium severity (CRITICAL/MAJOR demoted)
- Output filter rewriting findings to remove external claims or suppressing entirely when no diff-grounded core remains
- Collapsed `<details>` block in review summary for transparency on suppressed findings

## v0.23 (2026-03-01)

Interactive Troubleshooting.

### Added

- State-filtered vector search and resolution-focused thread assembler for troubleshooting retrieval from closed issues
- Troubleshooting agent with LLM synthesis, provenance citations, and keyword-based intent classification
- Issue outcome capture via `issues.closed` webhook with resolution classification and delivery-ID dedup
- Beta-Binomial Bayesian duplicate threshold auto-tuning per repo with sample gate and [50,95] clamping
- Nightly reaction sync polling thumbs up/down on triage comments as secondary feedback signal for threshold learning

## v0.22 (2026-02-27)

Issue Intelligence.

### Added

- Historical issue corpus population via backfill script with Voyage AI embeddings, HNSW-indexed vectors, PR filtering, and cursor-based resume
- Nightly incremental sync via GitHub Actions cron job for issues and comments updated since last sync
- High-confidence duplicate detection with top-3 candidate formatting, fail-open design, and comment-only policy (never auto-closes)
- Auto-triage on `issues.opened` with config gate (`autoTriageOnOpen`), four-layer idempotency, and duplicate detection integration
- PR-issue linking via explicit reference parsing (fixes/closes/relates-to regex) and semantic search fallback, with linked issue context injected into review prompts
- Issue corpus wired as 5th source in unified cross-corpus RRF retrieval with `[issue: #N] Title (status)` citations

## v0.21 (2026-02-27)

Issue Triage Foundation.

### Added

- Issue corpus with PostgreSQL `issues` and `issue_comments` tables, HNSW vector indexes, and weighted tsvector GIN indexes
- `github_issue_label` MCP tool with label pre-validation, partial application, closed-issue warning, and rate limit retry
- `github_issue_comment` MCP tool with raw markdown and structured input, update-by-ID, and max length enforcement
- Issue template parser extracting YAML frontmatter and section headers from `.github/ISSUE_TEMPLATE/` templates
- Triage validation agent with missing-section guidance, `needs-info:{slug}` label recommendations, and per-issue cooldown

## v0.20 (2026-02-26)

Multi-Model & Active Intelligence.

### Added

- Multi-LLM task routing via Vercel AI SDK with task-type-based model selection, per-repo `.kodiai.yml` overrides, and automatic provider fallback
- Per-invocation cost tracking logging model, provider, token counts, and estimated USD to Postgres
- Contributor profiles with GitHub/Slack identity linking via slash commands, expertise inference with exponential decay, and 4-tier adaptive review depth
- Wiki staleness detection with two-tier evaluation (cheap heuristic pass then LLM), file-path evidence, and scheduled Slack reports
- HDBSCAN-based review pattern clustering with UMAP dimensionality reduction, auto-generated theme labels, and footnote injection in PR reviews

## v0.19 (2026-02-25)

Intelligent Retrieval Enhancements.

### Added

- Language-aware retrieval boosting with 61-extension classification map and related-language affinity
- Specialized `[depends]` deep-review pipeline for dependency bump PRs with changelog fallback, consumer impact analysis, and hash verification
- CI failure recognition using Checks API base-branch comparison with flakiness history tracking and structured annotation comments
- Hunk-level code snippet embedding as 4th retrieval corpus with content-hash SHA-256 deduplication
- Cross-corpus retrieval expanded from 3 to 4 sources with unified RRF ranking and `[snippet]` labels

## v0.18 (2026-02-25)

Knowledge Ingestion.

### Added

- 18 months of PR review comment history backfilled with thread-aware chunking and Voyage AI embeddings
- kodi.wiki fully exported via MediaWiki API with section-based chunking, scheduled incremental sync, and wiki citations
- Hybrid BM25+vector search per corpus using tsvector GIN indexes with Reciprocal Rank Fusion merging
- Unified cross-corpus retrieval pipeline: single call fans out to code, review comments, and wiki with source-aware re-ranking
- All consumers wired to unified retrieval with `[wiki: Page]` / `[review: PR #]` / `[code]` citations

## v0.17 (2026-02-24)

Infrastructure Foundation.

### Added

- Graceful shutdown with SIGTERM handling, in-flight request drain, and webhook queue for replay on restart
- Zero-downtime deploys with PostgreSQL health probes and rolling deploy config
- Unified `src/knowledge/` module with `createRetriever()` factory replacing duplicate retrieval paths

### Changed

- PostgreSQL + pgvector replaces all SQLite storage -- HNSW vector indexes, tsvector columns, single DATABASE_URL connection pool
- SQLite fully removed -- zero sqlite-vec/better-sqlite3 dependencies in application code

## v0.16 (2026-02-24)

Review Coverage & Slack UX.

### Added

- Draft PRs now reviewed with soft suggestive tone, memo badge, and draft framing
- Non-blocking VoyageAI embeddings smoke test on container boot
- Generic InMemoryCache utility with TTL and maxSize eviction, eliminating 4 unbounded memory leak vectors

### Changed

- Slack responses rewritten for conciseness -- answer-first opening, banned preamble/closing phrases, length calibration
- Dockerfile switched from Alpine to Debian for sqlite-vec glibc compatibility

## v0.15 (2026-02-19)

Slack Write Workflows.

### Added

- Deterministic Slack write-intent routing with explicit prefix detection and ambiguous read-only fallback
- Guarded PR-only write execution with Slack-to-GitHub publish flow mirroring comment links into threads
- High-impact confirmation gating for destructive/migration/security requests with 15-minute timeout and exact confirm commands

## v0.14 (2026-02-19)

Slack Integration.

### Added

- Slack ingress with fail-closed v0 signature/timestamp verification on `/webhooks/slack/events`
- Safety rails enforcing `#kodiai`-only, thread-only replies, and mention-only thread bootstrap
- Deterministic thread session semantics: `@kodiai` bootstrap starts threads, follow-ups auto-route without repeated mentions
- Read-only assistant routing with default repo context, explicit override, and one-question ambiguity handling

## v0.13 (2026-02-18)

Reliability Follow-Through.

### Added

- Deterministic live telemetry verification tooling and OPS75 preflight evidence gates
- Degraded retrieval contract hardening with exact-sentence disclosure enforcement
- Reliability regression gate CLI with deterministic check-ID diagnostics and release-blocking semantics
- Live OPS evidence capture runbook and smoke matrix for reproducible closure runs

## v0.12 (2026-02-17)

Operator Reliability & Retrieval Quality.

### Added

- Repository-scoped Search API caching with deterministic keys, TTL reuse, and in-flight de-duplication
- Rate-limit handling with retry, graceful degradation, and consistent partial analysis disclosure
- Multi-query retrieval across review and mention paths with deterministic merge/rerank and fail-open behavior
- Retrieval evidence with snippet anchors, strict prompt-budget trimming, and path-only fallback
- Conversational UX unified across issue/PR/review surfaces with one targeted clarifying-question fallback

### Changed

- Telemetry `cacheHitRate` now reports true Search cache behavior

## v0.11 (2026-02-16)

Issue Workflows.

### Added

- In-thread issue Q&A with code-aware file-path pointers and targeted clarifying questions
- Issue `@kodiai apply:` / `change:` PR creation against the default branch
- Idempotent replay, in-flight de-dupe, and rate-limit safety for issue write-mode
- Write policy guardrails: allow/deny path rules and secret-scan refusals with actionable remediation
- Permission remediation guidance with `.kodiai.yml` enablement and same-command retry

## v0.9 (2026-02-15)

Smart Dependencies & Resilience.

### Added

- Dynamic timeout scaling based on PR complexity (file count, LOC, language) with configurable `timeout.dynamicScaling` and `timeout.autoReduceScope` settings
- Auto scope reduction for high-risk PRs: escalates to minimal profile and caps file count when auto-profile selected
- Informative timeout messages showing what was reviewed and what was skipped, replacing generic error messages
- Multi-signal retrieval query builder using PR intent, detected languages, diff risk signals, and author tier (capped at 800 chars)
- Language-aware post-retrieval re-ranking with mild multipliers (0.85/1.15) boosting same-language historical findings
- Three-stage dependency bump detection pipeline: detect (title + label/branch signals), extract (package, versions, ecosystem), classify (major/minor/patch)
- Support for Dependabot and Renovate PR detection across npm, Go, Rust, and Python ecosystems
- Hand-rolled semver parser (~15 lines) for version comparison without external dependencies
- Security advisory lookup via GitHub Advisory Database for old and new dependency versions
- Changelog fetching with three-tier fallback: GitHub Releases API, CHANGELOG.md file, compare URL
- Breaking change detection from changelog content (BREAKING CHANGE markers, headings, bold patterns)
- Composite merge confidence scoring (high/moderate/low/critical) synthesizing semver, advisory, and breaking change signals
- Merge confidence badge displayed prominently in dependency bump review sections with human-readable rationale
- Silent approval body includes confidence line for dependency bump PRs

### Changed

- `timeout_partial` telemetry category distinguishes partial reviews (published before timeout) from full timeouts
- Dep bump prompt section injected after author tier, before path instructions in review prompt
- Advisory sections capped at 3 advisories max with informational framing (not alarm language)
- Changelog context bounded to 1500 chars to prevent prompt bloat

## v0.8 (2026-02-14)

Conversational Intelligence.

### Added

- PR intent parser extracting bracket tags (`[Component]`, `[WIP]`), conventional commit prefixes, and breaking change signals from PR metadata
- Review mode override via keywords in PR title/body (`[strict-review]`, `[quick-review]`, `[security-review]`, `[style-ok]`, `[no-review]`)
- Deterministic auto-profile selection: strict (<=100 lines), balanced (101-500), minimal (>500 lines)
- Multi-factor finding prioritization with composite scoring (severity + file risk + category + recurrence) and configurable weights
- Author experience adaptation classifying contributors into three tiers (first-time/regular/core) with tone-adjusted review feedback
- Author tier SQLite caching for fast lookup across reviews
- Conversational review via `@kodiai` follow-up replies to review findings with thread context and rate limiting
- Finding lookup callback decoupling knowledge store from mention context
- Defense-in-depth mention sanitization across all 12 outbound publish paths preventing self-trigger loops
- `botHandles` threaded through ExecutionContext to all MCP servers

## v0.7 (2026-02-14)

Intelligent Review Content.

### Added

- Language-aware enforcement pipeline with 10-pattern severity floor catalog
- Auto-suppress formatting/import violations when tooling configs detected (.prettierrc, .clang-format, .black, etc.) across 7 languages
- Elevation of safety-critical patterns to CRITICAL/MAJOR severity (C++ null deref/uninitialized, Go unchecked errors, Python bare except)
- Risk-weighted file prioritization for large PRs with 5-dimension scoring (lines changed + path risk + category + language + executable)
- Tiered large PR analysis: top 30 full review, next 20 abbreviated, rest mention-only
- Feedback-driven auto-suppression after 3+ thumbs-down from 3+ users across 2+ PRs
- Safety floors preventing suppression of CRITICAL and MAJOR security/correctness findings regardless of feedback volume
- Composable config schema for enforcement rules with per-language overrides

## v0.6 (2026-02-14)

Review Output Formatting & UX.

### Added

- Structured five-section review template: What Changed, Strengths, Observations, Suggestions, Verdict
- Impact vs Preference subsections separating real risks from style nits
- Inline severity tags (`[CRITICAL]`, `[MAJOR]`, etc.) on finding lines
- Explicit merge recommendations using blocker-driven verdict logic (Ready to merge / Ready with minor / Address before merging)
- Review Details as compact 4-line factual appendix (files, lines changed, findings, timestamp)
- Embed-or-standalone Review Details: published reviews embed in summary, clean reviews use standalone
- Delta re-review template showing only new/resolved/still-open findings
- Transition-based delta verdicts (green=improved, blue=unchanged, yellow=worsened)
- Discriminator chain pattern for composable output sanitization

## v0.5 (2026-02-13)

Advanced Learning & Language Support.

### Added

- SHA-keyed run state for idempotent webhook redelivery deduplication (base+head SHA pair)
- Embedding-backed learning memory with Voyage AI and sqlite-vec for semantic retrieval
- Repo-isolated vector storage with owner-level shared pool via partition key iteration
- Incremental re-review focusing on changed hunks with fingerprint-based finding deduplication
- Bounded retrieval context: topK=5, distanceThreshold=0.3, maxContextChars=2000 (all configurable)
- Multi-language classification for 20 languages with language-specific guidance for 9 major languages
- Configurable `outputLanguage` for localized review output preserving code snippet integrity
- Explainable delta reporting with new/resolved/still-open labels and learning provenance citations
- Distance-based provenance confidence labels (<=0.15 high, <=0.25 moderate, else low)

### Changed

- `onSynchronize` defaults to false (opt-in) to prevent expensive reviews on frequent pushes

## v0.4 (2026-02-12)

Intelligent Review System.

### Added

- Review mode, severity floor, focus areas, and enforced comment caps via `.kodiai.yml`
- Profile presets (strict/balanced/minimal) for review depth control
- Context-aware review pipeline with deterministic diff analysis and path-scoped instructions
- Persistent knowledge store with explicit suppressions and confidence threshold filtering
- Review Details metrics contract and persistence for review quality analysis
- Reaction-based feedback capture (thumbs-up/down) linked to stored findings with idempotent persistence

## v0.3 (2026-02-11)

Configuration & Observability.

### Added

- Forward-compatible config parsing with two-pass safeParse and section-level graceful degradation
- Enhanced config controls: review/mention/write-mode guardrails
- Persistent telemetry storage with SQLite WAL mode, 90-day retention, concurrent read/write
- Fire-and-forget telemetry capture pipeline (tokens, cost, duration, model) for every execution
- Telemetry opt-out and cost warning thresholds (nested under telemetry gate)
- CLI reporting tool (`scripts/`) with time/repo filtering and multiple output formats (table/JSON/CSV)
- Deployment infrastructure: `/app/data` directory with automatic startup maintenance

## v0.2 (2026-02-10)

Write Mode.

### Added

- Code modification via `@kodiai` mention: branch creation, commit, push with guardrails
- Write-mode reliability: clearer failure messages, safer retries, plan-only mode

## v0.1 (2026-02-09)

Initial shipped milestone.

### Added

- GitHub webhook server (`/webhooks/github`) with signature verification, delivery-id deduplication, and bot filtering
- Job infrastructure: per-installation queue + ephemeral shallow-clone workspaces with cleanup
- Execution engine: Claude Code via Agent SDK `query()` with MCP servers for GitHub interactions
- PR auto-review: inline comments with suggestion blocks, conditional summary comment, silent approvals for clean PRs, fork PR support
- Mention handling: `@kodiai` across issue/PR/review surfaces with tracking comment workflow
- Content safety: sanitization and TOCTOU protections for comment context
- Ops: timeouts and user-visible error reporting, Azure Container Apps deployment script, runbooks
- Review-request reliability: `review_requested` correlation by `deliveryId` and idempotent output publication on redelivery/retry

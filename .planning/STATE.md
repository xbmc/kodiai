# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-18)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Start v0.14 Slack Integration milestone (feature-first)

## Current Position

**Milestone:** v0.14 Slack Integration (in progress)
**Phase:** 79 - Slack Read-Only Assistant Routing (in progress)
**Current Plan:** 2
**Total Plans in Phase:** 2
**Status:** Ready to execute
**Last Activity:** 2026-02-18

**Progress:** [██████████] 100%

## Performance Metrics

| Plan | Duration | Scope | Files |
|------|----------|-------|-------|
| Phase 56 P01 | 6min | 2 tasks | 6 files |
| Phase 56 P02 | 9m | 2 tasks | 5 files |
| Phase 56 P03 | 4m | 2 tasks | 5 files |
| Phase 57 P01 | 6m | 2 tasks | 4 files |
| Phase 57 P02 | 0m | 1 task | 2 files |
| Phase 57 P03 | 11m | 2 tasks | 5 files |
| Phase 58 P01 | 3m | 1 tasks | 2 files |
| Phase 58 P02 | 7m | 2 tasks | 11 files |
| Phase 59 P01 | 2min | 2 tasks | 4 files |
| Phase 59 P02 | 1min | 2 tasks | 6 files |
| Phase 59 P03 | 9min | 2 tasks | 5 files |
| Phase 60 P01 | 1 min | 2 tasks | 2 files |
| Phase 60-issue-q-a P02 | 3 min | 2 tasks | 2 files |
| Phase 60-issue-q-a P03 | 3 min | 2 tasks | 2 files |
| Phase 61 P01 | 0 min | 2 tasks | 2 files |
| Phase 61 P02 | 2 min | 2 tasks | 2 files |
| Phase 61 P03 | 2 min | 2 tasks | 4 files |
| Phase 62 P01 | 2 min | 2 tasks | 2 files |
| Phase 62 P02 | 1 min | 2 tasks | 1 files |
| Phase 62 P03 | 0 min | 3 tasks | 2 files |
| Phase 63 P01 | 1 min | 2 tasks | 2 files |
| Phase 63 P02 | 3 min | 2 tasks | 1 files |
| Phase 64 P01 | 2 min | 2 tasks | 2 files |
| Phase 65 P01 | 2m14s | 2 tasks | 2 files |
| Phase 65 P02 | 3m18s | 2 tasks | 2 files |
| Phase 64 P02 | 9m | 2 tasks | 4 files |
| Phase 66 P01 | 1m43s | 2 tasks | 2 files |
| Phase 66 P02 | 3m23s | 2 tasks | 2 files |
| Phase 67 P01 | 3m29s | 2 tasks | 5 files |
| Phase 67 P02 | 3m14s | 2 tasks | 5 files |
| Phase 68 P01 | 2m21s | 1 tasks | 2 files |
| Phase 68 P02 | 7m32s | 2 tasks | 8 files |
| Phase 69 P01 | 2m | 1 tasks | 2 files |
| Phase 69 P02 | 13m | 2 tasks | 8 files |
| Phase 70 P01 | 2 min | 2 tasks | 4 files |
| Phase 70 P02 | 2 min | 2 tasks | 2 files |
| Phase 71 P01 | 1 min | 3 tasks | 2 files |
| Phase 72 P01 | 7 min | 3 tasks | 5 files |
| Phase 72-telemetry-follow-through P02 | 5 min | 3 tasks | 5 files |
| Phase 73-degraded-retrieval-contract P01 | 3 min | 2 tasks | 4 files |
| Phase 73-degraded-retrieval-contract P02 | 5 min | 2 tasks | 6 files |
| Phase 74 P01 | 3 min | 2 tasks | 2 files |
| Phase 74 P02 | 4 min | 2 tasks | 5 files |
| Phase 75-live-ops-verification-closure P01 | 1 min | 2 tasks | 6 files |
| Phase 75-live-ops-verification-closure P02 | 13 min | 2 tasks | 5 files |
| Phase 75-live-ops-verification-closure P03 | 6 min | 3 tasks | 6 files |
| Phase 75 P04 | 1 min | 2 tasks | 2 files |
| Phase 75-live-ops-verification-closure P05 | 2 min | 2 tasks | 2 files |
| Phase 77 P01 | 2 min | 3 tasks | 6 files |
| Phase 77 P02 | 2 min | 2 tasks | 5 files |
| Phase 78-slack-thread-session-semantics P01 | 2 min | 3 tasks | 6 files |
| Phase 79 P01 | 2 min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

All v0.9 decisions archived to `.planning/PROJECT.md` Key Decisions table.
- [v0.13-roadmap]: Milestone phase numbering continues from v0.12 at Phase 72 with no renumbering of shipped history.
- [v0.13-roadmap]: Requirements are grouped into three execution phases: observability follow-through (72), degraded retrieval contract (73), and regression gate (74).
- [v0.13-roadmap]: Each v0.13 requirement maps to exactly one phase for strict traceability (6/6 covered, 0 orphaned).
- [Phase 73]: Runtime disclosure contract is enforced with the exact sentence `Analysis is partial due to API limits.` on degraded review outputs, with non-degraded guardrails.
- [Phase 73]: Retrieval evidence rendering is budget-bounded and markdown-safe across review and mention surfaces, with deterministic path-only fallback.
- [Phase 73]: Live run-state idempotency prevents repeated review_requested events from reprocessing unchanged head/base pairs.
- [Phase 56]: Store dep bump merge history in knowledge DB keyed by (repo, pr_number) using INSERT OR IGNORE to handle redeliveries
- [Phase 56]: Use INSERT OR IGNORE with a partial unique index on retrieval_quality(delivery_id) to dedupe webhook redeliveries
- [Phase 56]: Compute retrieval avg_distance and language_match_ratio from reranked adjustedDistance/languageMatch (not raw distances)
- [Phase 57-analysis-layer]: Expose a test-only grep runner hook to make timeout behavior deterministic in unit tests
- [Phase 57-analysis-layer]: Added optional dependency injection hooks in createReviewHandler for deterministic unit tests (no behavior change in production).
- [Phase 58]: Made adaptive thresholds default-on via retrieval.adaptive (opt-out) to preserve legacy behavior while meeting RET-03 requirements.
- [Phase 60]: Issue Q&A guarantees are gated to mention.surface === issue_comment to avoid changing PR mention behavior.
- [Phase 60]: Issue prompt guidance now requires concrete path/path:line evidence or targeted clarifying questions when path context is missing.
- [Phase 60-issue-q-a]: Use adapter injection (globFiles, grepInFiles, readFile) to keep issue code-context extraction deterministic and testable without external services.
- [Phase 60-issue-q-a]: Enforce fail-open behavior for weak-signal or adapter-error scenarios by returning empty code context instead of blocking issue replies.
- [Phase 60-issue-q-a]: Apply buildIssueCodeContext only for mention.surface === issue_comment before prompt construction.
- [Phase 60-issue-q-a]: Use issue-specific fallback questions that ask for desired outcome, target files/areas, and constraints when published output is absent.
- [Phase 61]: Read-only guidance is explicit and default on issue_comment unless a message starts with apply: or change:.
- [Phase 61]: Change-request replies without write prefixes must include both exact opt-in commands: @kodiai apply: <same request> and @kodiai change: <same request>.
- [Phase 61]: Gate issue implementation asks before executor invocation by matching conservative implementation verbs when no apply:/change:/plan: prefix is present.
- [Phase 61]: Post issue opt-in guidance through direct issue comment creation so exact @kodiai apply/change commands are preserved in output.
- [Phase 61]: Normalize issue requests before intent matching and before generating apply/change command suggestions so wrapped phrasing stays deterministic.
- [Phase 61]: Add explicit anti-completion wording to issue prompt requirements to prevent non-prefixed read-only replies from implying repository edits were already made.
- [Phase 62]: Write-output identities now encode source type and source number so issue and PR write flows share deterministic branch derivation.
- [Phase 62]: Issue apply/change requests publish via deterministic bot branches and open PRs against the cloned default branch instead of requiring PR-only context.
- [Phase 62]: Success-path issue write-mode tests assert writeMode=true, deterministic branch push, and PR base derived from issue payload default branch.
- [Phase 62]: Issue write-mode refusal outcomes must always respond in issue comments with explicit no-change or policy-denied messaging instead of silent success.
- [Phase 62]: Use a fresh live @kodiai apply trigger on issue #52 and capture direct comment URLs as evidence.
- [Phase 62]: Treat write-mode-disabled bot reply as validation failure evidence and do not claim PR creation success.
- [Phase 63]: Implicit issue intent detection now gates to read-only opt-in guidance and never auto-promotes to write mode.
- [Phase 63]: Issue opt-in guidance replies bypass mention sanitization so exact @kodiai apply/change commands remain copyable.
- [Phase 63]: User-directed policy override re-enables implicit write-mode auto-promotion for conversational issue implementation asks because write actions stay PR-only and non-destructive.
- [Phase 63]: Assert concurrent in-flight dedupe via order-insensitive reply checks to avoid race-dependent flakes.
- [Phase 63]: Validate repo-scoped write minInterval behavior using distinct issue comment IDs to isolate rate limiting from dedupe keys.
- [Phase 64]: Mirror PR policy refusal fixtures in issue_comment tests to keep guardrail coverage surface-consistent.
- [Phase 64]: Include an explicit .kodiai.yml update hint for allowPaths refusals so issue guidance is directly actionable.
- [Phase 65]: Disabled write-mode issue replies now include a fixed .kodiai.yml snippet and same-command retry instruction.
- [Phase 65]: Write-disabled retry commands are posted unsanitized so @kodiai apply/change remains copyable.
- [Phase 65]: Permission-classified write failures now bypass generic error comments and emit deterministic remediation guidance.
- [Phase 65]: Permission remediation includes minimum Contents/Pull requests/Issues write scopes plus same-command retry instructions.
- [Phase 64]: Export enforceWritePolicy and buildWritePolicyRefusalMessage for direct unit testing of write-policy contracts.
- [Phase 64]: Lock refusal messaging with unit assertions for deny, allow, secret-scan, and no-change outcomes.
- [Phase 66]: Cache keys now serialize normalized repo/searchType/query plus recursively sorted semantic fields for deterministic equivalence.
- [Phase 66]: Search cache internals fail open by reporting bookkeeping errors through onError while preserving loader success/error behavior.
- [Phase 66]: Author-tier PR-count search now uses deterministic buildSearchCacheKey(repo/searchType/query/per_page) so equivalent lookups share one cache entry.
- [Phase 66]: Author-tier cache integration fails open by logging cache faults and falling back to direct Search API lookup without blocking review completion.
- [Phase 67]: Treat GitHub Search 403/429 responses with explicit rate-limit markers as retryable exactly once, then degrade without failing review execution.
- [Phase 67]: Force degraded reviews to include the exact sentence 'Analysis is partial due to API limits.' in prompt instructions for deterministic UAT and telemetry assertions.
- [Phase 67]: Store OPS-03 telemetry in a dedicated rate_limit_events table keyed by delivery_id for idempotent writes.
- [Phase 67]: Emit rate-limit telemetry once per review run using author-tier enrichment outcomes and keep write failures non-blocking.
- [Phase 68]: Normalize retrieval signals to lowercase collapsed-whitespace text to guarantee equivalent variant outputs across casing/spacing differences.
- [Phase 68]: Rank merged hits by aggregated weighted score with deterministic tie-breakers (distance, variant priority, stable key) so ordering is input-order independent.
- [Phase 68]: Run retrieval variants with bounded concurrency=2 and shared topK partitioning to preserve latency guardrails.
- [Phase 68]: Keep retrieval fail-open at variant granularity for review and mention; only drop retrieval context when all variants fail.
- [Phase 68]: Cap mention retrieval prompt context at three merged findings to keep mention replies concise and grounded.
- [Phase 69]: Snippet extraction fails open per finding by degrading to path-only anchors instead of throwing.
- [Phase 69]: Budget trimming keeps lowest-distance anchors first and removes overflow deterministically by path and line tie-breakers.
- [Phase 69]: Review retrieval budgets are enforced at prompt-render time using knowledge.retrieval.maxContextChars so retrieval sections are deterministically omitted when nothing fits.
- [Phase 69]: Mention retrieval context keeps topK <= 3 and applies a fixed 1200-char cap to maintain concise, bounded conversational prompts.
- [Phase 70]: Moved direct-answer/evidence/next-step instructions into a shared Conversational Response Contract section for all mention surfaces.
- [Phase 70]: Standardized runtime non-published fallback to one targeted clarifying question while keeping existing write-intent and fail-open safety gates unchanged.
- [Phase 70]: Prompt contract checks assert durable markers and sequence order instead of brittle full-paragraph snapshots.
- [Phase 70]: PR top-level mention fixtures include issue.number plus pull_request shape to validate PR-surface behavior without issue-only intent leakage.
- [Phase 71]: Author classification cache reads remain independent from Search cache-hit telemetry so cacheHitRate reflects Search API cache behavior only.
- [Phase 71]: Search cache-hit signal uses getOrLoad loader execution semantics; fail-open direct lookups and degraded paths report deterministic misses.
- [Phase 72]: Exactly-once rate-limit telemetry identity is enforced as (delivery_id,event_type), replacing delivery-only uniqueness.
- [Phase 72]: Replay writes for identical delivery/event pairs use INSERT OR IGNORE to preserve first-write telemetry truth while allowing distinct event types.
- [Phase 72-telemetry-follow-through]: Phase 72 verification is encoded as fixed six-run identities (review+mention x prime/hit/changed-miss) to remove operator improvisation.
- [Phase 72-telemetry-follow-through]: Final operator verdicts must cite DB check IDs, while risk/demurral language remains in analysis text only.
- [Phase 73-degraded-retrieval-contract]: Use post-execution summary enforcement keyed off searchRateLimitDegradation.degraded to guarantee RET-06 disclosure even when model wording drifts.
- [Phase 73-degraded-retrieval-contract]: Share a single exported disclosure sentence constant across prompt and runtime publish layers to prevent wording divergence.
- [Phase 73-degraded-retrieval-contract]: Enforce retrieval maxChars against fully rendered section text (header plus bullets) so prompt budgets cannot overflow.
- [Phase 73-degraded-retrieval-contract]: Normalize backticks in path-only fallback evidence to apostrophes to preserve markdown validity when snippet anchors are missing.
- [Phase 74]: Issue write publish failures now return machine-checkable status pr_creation_failed with failed-step diagnostics.
- [Phase 74]: Issue write-mode PR creation retries exactly once before terminal failure response.
- [Phase 74]: Issue write-mode success requires branch push, PR URL creation, and issue linkback comment posting.
- [Phase 74]: Use machine-checkable CAP-74/REL-74/RET-74 check IDs so gate output is actionable and release-blocking without ambiguous wording.
- [Phase 74]: Validate Azure runtime prerequisites with deterministic non-destructive permission probes and fail closed when write/push prerequisites are missing.
- [Phase 75-live-ops-verification-closure]: Use TELEMETRY_RATE_LIMIT_FAILURE_IDENTITIES as an opt-in runtime allow-list so normal production telemetry behavior remains unchanged unless explicitly enabled.
- [Phase 75-live-ops-verification-closure]: Force rate-limit telemetry failures at the telemetry store persistence boundary while preserving handler-level fail-open completion semantics.
- [Phase 75-live-ops-verification-closure]: Use explicit '<delivery_id>:<event_type>' identity arguments for degraded and fail-open checks so evidence mapping stays deterministic and auditable.
- [Phase 75-live-ops-verification-closure]: Split OPS75 verification into cache, exactly-once, and fail-open check families with a machine-checkable final verdict line that cites check IDs only.
- [Phase 75-live-ops-verification-closure]: Guard author-cache writes at the store boundary: skip malformed repo/login identities instead of throwing DB write errors into live OPS runs.
- [Phase 75-live-ops-verification-closure]: Require explicit accepted review_requested identities (--review-accepted) and fail preflight when they diverge from the review matrix lane.
- [Phase 75-live-ops-verification-closure]: Treat non-passing live OPS75 reruns as release blockers and record exact failing check IDs instead of claiming closure.
- [Phase 75-live-ops-verification-closure]: Treat OPS75 identity capture as a hard pre-verification gate before reruns.
- [Phase 75-live-ops-verification-closure]: Publish failing OPS75 check IDs verbatim when Option A reruns do not meet closure prerequisites.
- [Phase 75-live-ops-verification-closure]: Preflight now hard-fails by check ID when any lane identity is missing, duplicated, or mismatched before verifier execution.
- [Phase 75-live-ops-verification-closure]: Smoke evidence publishes explicit identity values and carries forward failing OPS75 check IDs instead of closure language when prerequisites are unmet.
- [Phase 77]: Slack ingress verifies raw request body and timestamp before JSON parsing to preserve signature integrity and fail closed.
- [Phase 77]: Verified Slack event callbacks return immediate HTTP 200 acknowledgment while downstream processing remains asynchronous.
- [Phase 77]: Slack v1 allows only top-level mention bootstrap in #kodiai and ignores in-thread follow-up messages until Phase 78 session semantics.
- [Phase 77]: Allowed Slack route path forwards only normalized bootstrap payloads with replyTarget fixed to thread-only to prevent top-level post drift.
- [Phase 78-slack-thread-session-semantics]: Thread session state stays in-process and deterministic for v1; no persistence layer is introduced in this phase.
- [Phase 78-slack-thread-session-semantics]: Rails allow in-thread follow-up only when channel+thread session is active, preserving deterministic ignore behavior for non-starters.
- [Phase 78-slack-thread-session-semantics]: All allowed addressed Slack payloads retain replyTarget=thread-only to prevent top-level channel response drift.
- [Phase 79]: Repo context defaults to xbmc/xbmc unless exactly one explicit owner/repo override is present.
- [Phase 79]: Ambiguous or malformed repo references publish exactly one deterministic clarifying question and skip execution.
- [Phase 79]: Slack assistant execution is enforced read-only via writeMode=false with inline/comment publish tools disabled and explicit no-edit/no-branch/no-build prompt constraints.

### Key Constraints (Carry-Forward)

- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- Recency weighting needs severity-aware decay floor (0.3 minimum)
- Checkpoint publishing must use buffer-and-flush on abort, not streaming
- Schema migrations must be additive-only (new tables, nullable columns)

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |

## Session Continuity

**Last session:** 2026-02-18T06:02:57.739Z
**Stopped At:** Completed 79-01-PLAN.md
**Resume File:** None
**Next action:** Run `/gsd-plan-phase 79`

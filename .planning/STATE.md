# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-16)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Milestone v0.12 initialized; start execution planning for phase 66

## Current Position

**Milestone:** v0.12 Operator Reliability & Retrieval Quality (planned)
**Phase:** None (planning complete)
**Current Plan:** 00
**Total Plans in Phase:** 0
**Status:** Phase complete — ready for verification
**Last Activity:** 2026-02-16

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

## Accumulated Context

### Decisions

All v0.9 decisions archived to `.planning/PROJECT.md` Key Decisions table.
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

**Last session:** 2026-02-16T23:50:34.639Z
**Stopped At:** Completed 66-02-PLAN.md
**Resume File:** None
**Next action:** /gsd-plan-phase 66

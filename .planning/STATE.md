# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-16)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Milestone v0.11 Issue Workflows -- phase 61 complete and verified; ready to plan phase 62

## Current Position

**Milestone:** v0.11 Issue Workflows
**Phase:** Phase 61 (Read-Only + Intent Gating)
**Current Plan:** 03
**Total Plans in Phase:** 3
**Status:** Phase 61 complete — ready to plan Phase 62
**Last Activity:** 2026-02-16 — phase 61 gap closure executed, deployed, and live-verified

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

**Last session:** 2026-02-16T17:03:00.000Z
**Stopped At:** Completed phase 61 live verification (issues 51/52)
**Resume File:** None
**Next action:** /gsd-plan-phase 62

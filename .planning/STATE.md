---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: Issue Intelligence
status: phase_complete
stopped_at: Phase 109 complete
last_updated: "2026-02-27T19:15:00Z"
progress:
  total_phases: 109
  completed_phases: 109
  total_plans: 281
  completed_plans: 281
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-26)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.22 Issue Intelligence -- Phase 109: Issue Corpus Retrieval Integration

## Current Position

Phase: 109 of 109 (Issue Corpus Retrieval Integration) — COMPLETE
Plan: 1 of 1 in current phase (complete)
Status: Phase 109 complete — all milestone phases done
Last activity: 2026-02-27 -- Phase 109 executed

Progress: [████████████████████] 100% (109/109 phases)

## Accumulated Context

### Decisions

All decisions through v0.21 archived to `.planning/PROJECT.md` Key Decisions table.

- Phase 109-01: Issue weights locked at pr_review=0.8, issue=1.5, question=1.2, slack=1.0
- Phase 109-01: Citation format [issue: #N] Title (status) with GitHub URLs

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- All corpora use voyage-code-3 (1024 dims) -- consistent model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks (PR review, mentions, Slack write); Vercel AI SDK owns non-agentic tasks only

### Key Infrastructure (v0.17-v0.21 Foundation)

- PostgreSQL + pgvector with HNSW indexes and tsvector GIN indexes
- Five knowledge corpora: `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`
- `createRetriever()` factory: single dep injection point for all retrieval
- Unified cross-corpus retrieval: BM25+vector hybrid per corpus, RRF merge, cosine dedup
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns
- Multi-LLM: Vercel AI SDK task router + provider factory for non-agentic tasks
- Cost tracking: per-invocation model/token/cost logging to Postgres
- Contributor profiles: identity linking, expertise scoring, 4-tier adaptive review
- Issue triage: template parser, validation agent, MCP tools, per-issue cooldown, config-gated

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Research Notes (v0.22)

- Backfill follows `review-comment-backfill.ts` pattern exactly; nightly sync follows `wiki-sync.ts`
- Duplicate detection thresholds (0.12/0.18/0.25 cosine distance bands) need empirical calibration
- Embed problem summary only (title + description section), not full body with logs/system info
- Three-layer idempotency for auto-triage: delivery-ID dedup + advisory lock + per-issue cooldown
- `issue-opened.ts` must be a separate handler, not added to the 2000+ line mention handler

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 13 | Deploy build, update README, triage GitHub issues | 2026-02-26 | df7182394f | Verified | [13-deploy-build-update-readme-triage-github](./quick/13-deploy-build-update-readme-triage-github/) |
| 14 | Fix CI test failures in buildAuthorExperienceSection | 2026-02-26 | 8248d970c6 | | [14-fix-ci-test-failures-in-buildauthorexper](./quick/14-fix-ci-test-failures-in-buildauthorexper/) |

## Session Continuity

**Last session:** 2026-02-27T19:15:00Z
**Stopped At:** Phase 109 complete — all v0.22 milestone phases done
**Resume with:** `/gsd:complete-milestone` or `/gsd:verify-work 109`

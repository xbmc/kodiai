---
gsd_state_version: 1.0
milestone: v0.20
milestone_name: Multi-Model & Active Intelligence
status: milestone_complete
stopped_at: v0.20 milestone complete
last_updated: "2026-02-26T22:45:00.000Z"
progress:
  total_phases: 102
  completed_phases: 102
  total_plans: 265
  completed_plans: 265
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-26)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.20 shipped — planning next milestone

## Current Position

Milestone: v0.20 Multi-Model & Active Intelligence — SHIPPED 2026-02-26
All 6 phases (97-102), 17 plans complete.
Last activity: 2026-02-26 - Completed quick task 13: Deploy build, update README, triage GitHub issues

## Accumulated Context

### Decisions

All decisions through v0.20 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- All corpora use voyage-code-3 (1024 dims) -- consistent model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks (PR review, mentions, Slack write); Vercel AI SDK owns non-agentic tasks only

### Key Infrastructure (v0.17-v0.20 Foundation)

- PostgreSQL + pgvector with HNSW indexes and tsvector GIN indexes
- Four knowledge corpora: `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`
- `createRetriever()` factory: single dep injection point for all retrieval
- Unified cross-corpus retrieval: BM25+vector hybrid per corpus, RRF merge, cosine dedup
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns
- Review pattern clustering: HDBSCAN + UMAP, weekly refresh, dual-signal matcher, footnote injection
- Multi-LLM: Vercel AI SDK task router + provider factory for non-agentic tasks
- Cost tracking: per-invocation model/token/cost logging to Postgres
- Contributor profiles: identity linking, expertise scoring, 4-tier adaptive review
- Wiki staleness: two-tier detection, scheduled Slack reports

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 13 | Deploy build, update README, triage GitHub issues | 2026-02-26 | df7182394f | Verified | [13-deploy-build-update-readme-triage-github](./quick/13-deploy-build-update-readme-triage-github/) |

## Session Continuity

**Last session:** 2026-02-26
**Stopped At:** v0.20 milestone complete
**Resume with:** `/gsd:new-milestone`

---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: Issue Triage Foundation
status: unknown
stopped_at: Phase 104 context gathered
last_updated: "2026-02-27T01:00:29.134Z"
progress:
  total_phases: 81
  completed_phases: 77
  total_plans: 189
  completed_plans: 198
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-26)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.21 Issue Triage Foundation -- Phase 103 ready to plan

## Current Position

Phase: 103 of 105 (Issue Corpus Schema & Store)
Plan: --
Status: Ready to plan
Last activity: 2026-02-26 -- Roadmap created for v0.21

Progress: [░░░░░░░░░░] 0%

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
- Multi-LLM: Vercel AI SDK task router + provider factory for non-agentic tasks
- Cost tracking: per-invocation model/token/cost logging to Postgres
- Contributor profiles: identity linking, expertise scoring, 4-tier adaptive review

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Research Notes (v0.21)

- Phases 103 and 104 are independent -- can execute in either order
- Phase 105 depends on both 103 and 104
- xbmc/xbmc uses `.md` markdown templates (not YAML forms) -- parser must handle section headers
- Label 404 handling critical: MCP tool must validate label existence before applying
- Per-issue cooldown (default 30 min) prevents comment spam loops
- Issue corpus schema must include `state`, `author_association`, `label_names`, `template_slug`, `comment_count`

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 13 | Deploy build, update README, triage GitHub issues | 2026-02-26 | df7182394f | Verified | [13-deploy-build-update-readme-triage-github](./quick/13-deploy-build-update-readme-triage-github/) |
| 14 | Fix CI test failures in buildAuthorExperienceSection | 2026-02-26 | 8248d970c6 | | [14-fix-ci-test-failures-in-buildauthorexper](./quick/14-fix-ci-test-failures-in-buildauthorexper/) |

## Session Continuity

**Last session:** 2026-02-27T01:00:29.131Z
**Stopped At:** Phase 104 context gathered
**Resume with:** `/gsd:plan-phase 103`

---
gsd_state_version: 1.0
milestone: v0.23
milestone_name: Interactive Troubleshooting
status: unknown
stopped_at: Completed 113-02-PLAN.md (threshold learning handler wiring)
last_updated: "2026-02-28T08:49:51.063Z"
progress:
  total_phases: 85
  completed_phases: 80
  total_plans: 196
  completed_plans: 203
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-27)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.23 Interactive Troubleshooting — phases 110-113 complete, 114 remaining

## Current Position

Milestone: v0.23 Interactive Troubleshooting — IN PROGRESS
Phases: 113 of 114 (1 phase remaining)
Status: Phase 113 threshold learning complete (2 of 2 plans done), phase 114 remaining
Last activity: 2026-02-28 -- threshold learning handler wiring complete

Progress: [████████████████████] 99% (113/114 phases, 288/292 plans)

## Accumulated Context

### Decisions

All decisions through v0.22 archived to `.planning/PROJECT.md` Key Decisions table.

- **Independent parallel handler (Option A):** Troubleshooting handler registers on `issue_comment.created` alongside mention handler; both run concurrently via `Promise.allSettled` (Phase 111)
- **WikiKnowledgeMatch field mapping:** Uses `rawText`/`pageTitle`/`pageUrl` (not research example's `content`/`title`/`url`) (Phase 111)
- **Minimal handler deps for outcome capture:** issue-closed handler uses only eventRouter, sql, logger -- no GitHub API needed (Phase 112)
- **Logical gate placement:** issue-closed handler inside issueStore && embeddingProvider block (outcome only meaningful when auto-triage active) (Phase 112)
- **Non-fatal warn on comment_github_id failure:** Fail-open philosophy -- reaction tracking is supplementary, not critical path (Phase 112)
- **Skip TN observations:** Avoid drowning alpha with non-duplicate-detection signal (Phase 113)
- **Atomic SQL-side increment:** UPSERT with SQL-side alpha/beta increment prevents read-then-write race conditions (Phase 113)
- **Module defaults for threshold resolution:** getEffectiveThreshold called with module defaults (minSamples=20, floor=50, ceiling=95), no config surface needed yet (Phase 113)
- **Triage gate for observations:** recordObservation gated on triageId !== null to only learn from Kodiai-triaged issues (Phase 113)

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- All corpora use voyage-code-3 (1024 dims) -- consistent model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks (PR review, mentions, Slack write); Vercel AI SDK owns non-agentic tasks only

### Key Infrastructure (v0.17-v0.22 Foundation)

- PostgreSQL + pgvector with HNSW indexes and tsvector GIN indexes
- Five knowledge corpora: `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`
- `createRetriever()` factory: single dep injection point for all retrieval (all 5 corpora wired)
- Unified cross-corpus retrieval: BM25+vector hybrid per corpus, RRF merge, cosine dedup
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns
- Multi-LLM: Vercel AI SDK task router + provider factory for non-agentic tasks
- Cost tracking: per-invocation model/token/cost logging to Postgres
- Contributor profiles: identity linking, expertise scoring, 4-tier adaptive review
- Issue intelligence: historical corpus, nightly sync, duplicate detection, auto-triage, PR-issue linking, retrieval integration

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 13 | Deploy build, update README, triage GitHub issues | 2026-02-26 | df7182394f | Verified | [13-deploy-build-update-readme-triage-github](./quick/13-deploy-build-update-readme-triage-github/) |
| 14 | Fix CI test failures in buildAuthorExperienceSection | 2026-02-26 | 8248d970c6 | | [14-fix-ci-test-failures-in-buildauthorexper](./quick/14-fix-ci-test-failures-in-buildauthorexper/) |

## Session Continuity

**Last session:** 2026-02-28T08:45:29Z
**Stopped At:** Completed 113-02-PLAN.md (threshold learning handler wiring)
**Resume with:** `/gsd:execute-phase 114` to continue with reaction tracking

### Resume Context
- v0.23 source: Issue #75 (Interactive Troubleshooting)
- Research: `.planning/research/TROUBLESHOOTING.md` and `.planning/research/OUTCOME-LEARNING.md`
- REQUIREMENTS.md: 20 requirements (TSHOOT-01..08, OUTCOME-01..05, LEARN-01..04, REACT-01..03)
- ROADMAP.md: Phases 110-114 added
- Phase dependency: 110→111 (retrieval→agent), 112→113 (outcome→threshold), 112→114 (outcome→reactions)
- Tracks are independent: troubleshooting (110-111) and outcome learning (112-114) can execute in either order

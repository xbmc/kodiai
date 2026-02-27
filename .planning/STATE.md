---
gsd_state_version: 1.0
milestone: v0.22
milestone_name: Issue Intelligence
status: new_milestone_in_progress
stopped_at: v0.23 requirements written, roadmap not yet added
last_updated: "2026-02-27T20:00:00Z"
progress:
  total_phases: 109
  completed_phases: 109
  total_plans: 283
  completed_plans: 283
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-27)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.23 Interactive Troubleshooting — new-milestone in progress

## Current Position

Milestone: v0.22 Issue Intelligence — SHIPPED
Phases: 109 of 109 (all complete)
Status: Milestone archived, tag created
Last activity: 2026-02-27 -- v0.22 milestone completed

Progress: [████████████████████] 100% (22 milestones shipped)

## Accumulated Context

### Decisions

All decisions through v0.22 archived to `.planning/PROJECT.md` Key Decisions table.

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

**Last session:** 2026-02-27T20:00:00Z
**Stopped At:** v0.23 new-milestone — REQUIREMENTS.md written, research complete, roadmap phases not yet added
**Resume with:** Continue `/gsd:new-milestone` — add phases 110-114 to ROADMAP.md, update PROJECT.md, commit

### Resume Context
- v0.23 source: Issue #75 (Interactive Troubleshooting)
- Research done: `.planning/research/TROUBLESHOOTING.md` and `.planning/research/OUTCOME-LEARNING.md`
- REQUIREMENTS.md created with 20 requirements (TSHOOT-01..08, OUTCOME-01..05, LEARN-01..04, REACT-01..03)
- Phases planned (not yet in ROADMAP.md):
  - Phase 110: Troubleshooting Retrieval Foundation (TSHOOT-01, 02, 03) — IssueStore stateFilter, thread assembler, fallback
  - Phase 111: Troubleshooting Agent (TSHOOT-04, 05, 06, 07, 08) — handler, intent classifier, mention wiring, config
  - Phase 112: Outcome Capture (OUTCOME-01..05, REACT-01) — issues.closed handler, outcome table, comment_github_id capture
  - Phase 113: Threshold Learning (LEARN-01..04) — Beta-Binomial update, threshold state table, duplicate detector integration
  - Phase 114: Reaction Tracking (REACT-02, 03) — nightly sync job for triage comment reactions

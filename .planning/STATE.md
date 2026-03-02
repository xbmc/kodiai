---
gsd_state_version: 1.0
milestone: v0.24
milestone_name: Hallucination Prevention & Fact Verification
status: defining_requirements
last_updated: "2026-03-02"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-02)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.24 Hallucination Prevention & Fact Verification

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-02 — Milestone v0.24 started

## Accumulated Context

### Decisions

All decisions through v0.23 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- All corpora use voyage-code-3 (1024 dims) -- consistent model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks (PR review, mentions, Slack write); Vercel AI SDK owns non-agentic tasks only

### Key Infrastructure (v0.17-v0.23 Foundation)

- PostgreSQL + pgvector with HNSW indexes and tsvector GIN indexes
- Five knowledge corpora: `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`
- `createRetriever()` factory: single dep injection point for all retrieval (all 5 corpora wired)
- Unified cross-corpus retrieval: BM25+vector hybrid per corpus, RRF merge, cosine dedup
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns
- Multi-LLM: Vercel AI SDK task router + provider factory for non-agentic tasks
- Cost tracking: per-invocation model/token/cost logging to Postgres
- Contributor profiles: identity linking, expertise scoring, 4-tier adaptive review
- Issue intelligence: historical corpus, nightly sync, duplicate detection, auto-triage, PR-issue linking, retrieval integration
- Troubleshooting: resolved-issue retrieval, thread assembly, LLM synthesis with citations, config-gated
- Outcome feedback loop: issue-closed capture, Beta-Binomial Bayesian threshold auto-tuning, nightly reaction sync

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Hallucination Context (v0.24 Motivation)

- PR #27932: bot fabricated libxkbcommon version numbers (1.13.0, 1.11.0, 1.12.x) as [CRITICAL]
- Root cause 1: Prompt says "Do NOT use hedged or vague language" — encourages assertiveness over accuracy for external facts
- Root cause 2: No post-generation fact-verification layer — confidence scoring is mathematical, not semantic
- Root cause 3: CRITICAL findings bypass all suppression — hallucinated CRITICALs are worst-case
- Key files: src/execution/review-prompt.ts (line 238, 1697, 1740), src/knowledge/confidence.ts, src/feedback/safety-guard.ts, src/enforcement/severity-floors.ts

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 13 | Deploy build, update README, triage GitHub issues | 2026-02-26 | df7182394f | Verified | [13-deploy-build-update-readme-triage-github](./quick/13-deploy-build-update-readme-triage-github/) |
| 14 | Fix CI test failures in buildAuthorExperienceSection | 2026-02-26 | 8248d970c6 | | [14-fix-ci-test-failures-in-buildauthorexper](./quick/14-fix-ci-test-failures-in-buildauthorexper/) |
| 15 | Read thru issues, comment/close on completed | 2026-03-01 | | | [15-read-thru-issues-comment-close-on-comple](./quick/15-read-thru-issues-comment-close-on-comple/) |

## Session Continuity

**Last session:** 2026-03-02
**Stopped At:** Milestone v0.24 setup in progress
**Resume with:** `/gsd:new-milestone` or continue requirements definition

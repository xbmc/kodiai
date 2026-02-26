---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: Multi-Model & Active Intelligence
status: unknown
stopped_at: Phase 97 context gathered
last_updated: "2026-02-26T01:20:15.235Z"
progress:
  total_phases: 80
  completed_phases: 76
  total_plans: 186
  completed_plans: 195
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-25)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 97 -- Multi-LLM Routing & Cost Tracking

## Current Position

Phase: 97 (1 of 4) — Multi-LLM Routing & Cost Tracking
Plan: — (phase not yet planned)
Status: Ready to plan
Last activity: 2026-02-25 — v0.20 roadmap created (4 phases, 20 requirements)

Progress: [░░░░░░░░░░░░░░░░░░░░] 0% (0/0 plans)

## Accumulated Context

### Decisions

All decisions through v0.19 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- All corpora use voyage-code-3 (1024 dims) -- consistent model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks (PR review, mentions, Slack write); Vercel AI SDK owns non-agentic tasks only

### Key Infrastructure (v0.17-v0.19 Foundation)

- PostgreSQL + pgvector with HNSW indexes and tsvector GIN indexes
- Four knowledge corpora: `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`
- `createRetriever()` factory: single dep injection point for all retrieval
- Unified cross-corpus retrieval: BM25+vector hybrid per corpus, RRF merge, cosine dedup
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns

### Research Flags

- **Phase 99 (Wiki Staleness):** Heuristic for mapping wiki prose to code file paths needs validation against actual Kodi wiki content
- **Phase 100 (Pattern Clustering):** Python sidecar vs `umap-js` TypeScript-native UMAP needs spike evaluation

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

None.

## Session Continuity

**Last session:** 2026-02-26T01:20:15.233Z
**Stopped At:** Phase 97 context gathered
**Resume file:** .planning/phases/97-multi-llm-routing-cost-tracking/97-CONTEXT.md

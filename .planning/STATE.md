---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: Intelligent Retrieval Enhancements
status: unknown
stopped_at: Completed 93-04-PLAN.md
last_updated: "2026-02-25T17:56:00.350Z"
progress:
  total_phases: 80
  completed_phases: 77
  total_plans: 190
  completed_plans: 199
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-25)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Milestone v0.19 complete — all phases finished

## Current Position

Phase: 93 of 96 (Language-Aware Retrieval Boosting)
Plan: 4 of 4 in current phase (COMPLETE)
Status: Phase complete
Last activity: 2026-02-25 -- 93-04 complete: language wiring through handlers, wiki languageTags tests, e2e language boost tests

Progress: [████████████████████] 199/190 plans (100%)

## Performance Metrics

**Velocity:**
- Total plans completed: 227 (across 18 milestones)
- Average duration: varies by phase complexity
- Total execution time: cumulative across v0.1-v0.18

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

*Updated after each plan completion*
| Phase 93 P02 | 4 | 2 tasks | 5 files |
| Phase 93 P01 | 5 | 4 tasks | 8 files |
| Phase 93 P03 | 6 | 2 tasks | 6 files |

## Accumulated Context

### Decisions

All decisions through v0.18 archived to `.planning/PROJECT.md` Key Decisions table.
- [Phase 93]: Language tags determined at page level so all chunks from a page share the same tags
- [Phase 93]: Two-pass detection: fenced code blocks + prose mentions; default ['general'] for non-code pages
- [Phase 93]: Kept classifyFileLanguage returning Title Case for backward compatibility; classifyFileLanguageWithContext returns lowercase for DB storage
- [Phase 93]: .h files default to 'c', upgrade to 'cpp' when C++ context files present in PR; record.language takes precedence in writeMemory for caller pre-classification
- [Phase 93]: Boost-only policy in unified pipeline: non-matching language results never penalized, only matching ones boosted (LANG-03/LANG-04)
- [Phase 93]: Single location for language weighting per pipeline path: rerankByLanguage for legacy findings[], step 6e-bis for unified results — no double-boost
- [Phase 93]: classifyFileLanguageWithContext used for memory writes — resolves .h ambiguity using PR context files (not classifyFileLanguage which returns Title Case)
- [Phase 93]: prLanguages normalized to lowercase in mention.ts at construction time — single normalization site, keeps retrieval.ts clean

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Timeout retry capped at 1 max to avoid queue starvation
- Adaptive thresholds need minimum 8-candidate guard
- Existing `learning_memories` table uses voyage-code-3 (1024 dims) -- all corpora use same model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path

### Key Infrastructure (v0.17-v0.18 Foundation)

- PostgreSQL + pgvector with HNSW indexes (m=16, ef_construction=64) and tsvector GIN indexes
- Three knowledge corpora: `learning_memories` (code), `review_comments`, `wiki_pages`
- `createRetriever()` factory: single dep injection point for all retrieval
- Unified cross-corpus retrieval: BM25+vector hybrid per corpus, RRF merge, cosine dedup, source attribution
- VoyageAI embeddings: voyage-code-3, 1024 dims, fail-open with null returns

### Research Flags (v0.19)

- Phase 94 ([depends] deep review): Kodi `tools/depends/` build system patterns and C/C++ library-to-upstream-repo resolution may need a targeted spike during planning
- Phase 96 (hunk embedding): Voyage AI cost projections need validation against actual xbmc/xbmc PR volume before committing to default-on

### Critical Pitfalls (from research)

- Double language boost: keep weighting in ONE location (legacy reranker), never add second layer in unified pipeline
- CI API choice: use Checks API (`checks.listForRef`), NOT Actions API -- external CI invisible otherwise
- [depends] vs Dependabot mutual exclusivity: sequential detection, `detectDepBump()` first, `detectDependsPrefix()` fallback only
- Hunk embedding cost: feature-flagged off, cap 20 hunks/PR, TTL 90 days, only persist from PRs with findings

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

- `checks:read` GitHub App permission needs verification before Phase 95 -- may require App manifest update
- Search API rate limit (30/min) requires caching strategy validated under production load

## Session Continuity

**Last session:** 2026-02-25
**Stopped At:** Phase 93 complete, milestone v0.19 complete — all 4 phases finished
**Resume file:** None

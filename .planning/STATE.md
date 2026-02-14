# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-14)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 45 -- Author Experience Adaptation

## Current Position

Milestone: v0.8 Conversational Intelligence
Phase: 45 of 46 (Author Experience Adaptation)
Plan: 1 of 2 in current phase
Status: In Progress
Last activity: 2026-02-14 -- completed phase 45 plan 01 deterministic classifier and tone section builder

Progress: [#########-] 98%

## Performance Metrics

**Velocity:**
- Total plans completed: 113
- Average duration: 4 min
- Total execution time: ~466 min

**By latest shipped milestone (v0.7):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 39-language-aware-enforcement | 4 | ~12 min | ~3 min |
| 40-large-pr-intelligence | 4 | ~12 min | ~3 min |
| 41-feedback-driven-learning | 3 | ~9 min | ~3 min |
| 42-commit-message-keywords-pr-intent | 2 | ~30 min | ~15 min |
| 43-auto-profile-selection | 2 | ~4 min | ~2 min |
| Phase 44 P01 | 2 min | 2 tasks | 2 files |
| Phase 44 P02 | 2 min | 3 tasks | 4 files |
| Phase 45 P01 | 2 min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

All decisions logged in `.planning/PROJECT.md` Key Decisions table. v0.7 decisions archived.

Recent decisions affecting current work:
- Research recommends building keyword parsing first (pure-function, feeds into auto-profile)
- Zero new npm dependencies required for v0.8 -- all features use existing stack
- One new SQLite table needed: author experience cache (24-hour TTL)
- `author_association` may return NONE instead of FIRST_TIME_CONTRIBUTOR -- defensive handling required
- [Phase 42]: Conventional commit parsing now ignores leading bracket tags so [WIP] feat: still resolves intent.
- [Phase 42]: Large PR commit scanning uses strategic sampling (>50 commits): first 10, every 5th middle, last 10.
- [Phase 42]: [no-review] now short-circuits review before workspace creation and posts acknowledgment.
- [Phase 42]: Conventional commit metadata is now passed into prompt construction for type-specific review focus guidance.
- [Phase 43]: Profile precedence is fixed as keyword override > manual config > auto-threshold
- [Phase 43]: Auto selection metadata includes source and band for observability without handler coupling
- [Phase 43]: Handler now resolves a single profile selection object before applying presets
- [Phase 43]: Review Details always publishes profile source text (auto/manual/keyword) for traceability
- [Phase 44]: Unknown severity/category values fail open to neutral scoring defaults instead of throwing
- [Phase 44]: Prioritization weights are runtime-normalized and ties are resolved by original index for deterministic ranking
- [Phase 44]: Prioritization weights are configured under review.prioritization with bounded 0..1 values and section-level fallback behavior
- [Phase 44]: Cap overflow prioritization runs after suppression and confidence filtering, and non-selected findings are deleted through the existing inline cleanup path
- [Phase 45]: Definite author_association values short-circuit before PR-count enrichment to keep MEMBER/OWNER and FIRST_TIMER/FIRST_TIME_CONTRIBUTOR deterministic.
- [Phase 45]: Author experience tone adaptation is exposed as buildAuthorExperienceSection and intentionally not wired into buildReviewPrompt until plan 45-02 integration.

### Pending Todos

None yet.

### Blockers/Concerns

- `author_association` field inconsistency (NONE vs FIRST_TIME_CONTRIBUTOR) needs defensive handling in Phase 45
- Search API rate limit (30/min) requires caching strategy validated under production load

## Session Continuity

Last session: 2026-02-14
Stopped at: Completed 45-01-PLAN.md
Resume file: None
Next action: `/gsd-execute-phase 45` to continue with plan 45-02

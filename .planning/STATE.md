# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-14)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 43 -- Auto Profile Selection

## Current Position

Milestone: v0.8 Conversational Intelligence
Phase: 43 of 46 (Auto Profile Selection)
Plan: 2 of 2 in current phase
Status: Complete
Last activity: 2026-02-14 -- completed phase 43 auto profile selection

Progress: [##########] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 111
- Average duration: 4 min
- Total execution time: ~462 min

**By latest shipped milestone (v0.7):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 39-language-aware-enforcement | 4 | ~12 min | ~3 min |
| 40-large-pr-intelligence | 4 | ~12 min | ~3 min |
| 41-feedback-driven-learning | 3 | ~9 min | ~3 min |
| 42-commit-message-keywords-pr-intent | 2 | ~30 min | ~15 min |
| 43-auto-profile-selection | 2 | ~4 min | ~2 min |

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

### Pending Todos

None yet.

### Blockers/Concerns

- `author_association` field inconsistency (NONE vs FIRST_TIME_CONTRIBUTOR) needs defensive handling in Phase 45
- Search API rate limit (30/min) requires caching strategy validated under production load

## Session Continuity

Last session: 2026-02-14
Stopped at: Completed 43-02-PLAN.md
Resume file: None
Next action: `/gsd:plan-phase 44` to continue milestone v0.8

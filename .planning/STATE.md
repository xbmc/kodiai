# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-14)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.9 Phase 52 — Intelligent Retrieval

## Current Position

**Milestone:** v0.9 Smart Dependencies & Resilience
**Phase:** 52 of 55 (Intelligent Retrieval)
**Plan:** 1 of 2 complete
**Status:** In Progress
**Last Activity:** 2026-02-14 — Completed 52-01-PLAN.md (core retrieval functions)

**Progress:** [█████░░░░░] 50%

## Performance Metrics

**Velocity:**
- Total plans completed: 149
- Total milestones shipped: 8
- Total phases completed: 51

## Accumulated Context

### Decisions

All decisions logged in `.planning/PROJECT.md` Key Decisions table. v0.8 decisions archived.

- **51-01:** Timeout scales 0.5x-1.5x of base using formula base*(0.5+complexity), clamped [30,1800]
- **51-01:** Dynamic timeout features default enabled (opt-out via config)
- **51-02:** Scope reduction only applies when profileSelection.source === "auto" (respects explicit user choices)
- **51-02:** timeout_partial category used when isTimeout=true AND published=true
- **51-03:** Matched formatErrorComment assertion strings to actual SUGGESTIONS content for timeout_partial
- **52-01:** Query length capped at 800 chars to prevent embedding quality degradation
- **52-01:** Language reranking uses mild multipliers (0.85/1.15) as tiebreaker, not dominant factor
- **52-01:** Unknown-language records treated as neutral (1.0 multiplier) to avoid demoting config/docs

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load
- Changelog fetching returns stale/wrong/no data for 30-50% of packages (design fallback cascade in Phase 54)
- CVE data has false positive rates (frame as "advisory" not "vulnerability detected" in Phase 54)

## Session Continuity

**Last session:** 2026-02-14
**Stopped At:** Completed 52-01-PLAN.md (core retrieval functions TDD)
**Resume File:** None
**Next action:** Execute 52-02-PLAN.md (integration)

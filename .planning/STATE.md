# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-14)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.9 Phase 55 — Merge Confidence Scoring

## Current Position

**Milestone:** v0.9 Smart Dependencies & Resilience
**Phase:** 55 of 55 (Merge Confidence Scoring)
**Plan:** 1 of 2 complete
**Status:** In Progress
**Last Activity:** 2026-02-15 — Completed 55-01-PLAN.md (scoring function)

**Progress:** [█████████░] 50%

## Performance Metrics

**Velocity:**
- Total plans completed: 154
- Total milestones shipped: 8
- Total phases completed: 54

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
- **52-02:** distanceThreshold filters on raw distance before re-ranking; adjustedDistance only reorders results
- **52-02:** filesByLanguage keys used as prLanguages for both query construction and re-ranking
- **53-01:** Two-signal requirement for dep bump detection prevents false positives on human PRs
- **53-01:** Hand-rolled semver parser (~15 lines) avoids 376KB semver npm dependency
- **53-01:** Group bumps marked isGroup: true with ecosystem only, no per-package extraction
- **53-02:** Dep bump detection placed after diff collection since allChangedFiles needed for ecosystem resolution
- **53-02:** Dep bump prompt section injected after author tier, before path instructions
- **54-01:** Breaking change markers ordered most-specific first to prevent duplicate matches
- **54-01:** Removed generic BREAKING word marker; kept INCOMPATIBLE, heading, and bold patterns
- **54-01:** Both advisory API calls failing returns null (fail-open); one failing returns partial data
- **54-02:** Reuse idempotencyOctokit for enrichment calls (octokit not in scope at enrichment point)
- **54-02:** Advisory section capped at 3 advisories max; informational framing per STATE.md concern
- **55-01:** Used bun:test (not vitest) to match existing project test patterns
- **55-01:** Severity ordering uses numeric map for O(1) comparison instead of indexOf
- **55-01:** downgrade helper caps at 'low' to prevent invalid states

### Pending Todos

None.

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load
- Changelog fetching returns stale/wrong/no data for 30-50% of packages (design fallback cascade in Phase 54)
- CVE data has false positive rates (frame as "advisory" not "vulnerability detected" in Phase 54)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Fix Review Details placement and finding count mismatch in review output | 2026-02-14 | 7422965425 | [4-fix-review-details-placement-and-finding](./quick/4-fix-review-details-placement-and-finding/) |

## Session Continuity

**Last session:** 2026-02-15
**Stopped At:** Completed 55-01-PLAN.md (scoring function)
**Resume File:** None
**Next action:** 55-02-PLAN.md (integration wiring)

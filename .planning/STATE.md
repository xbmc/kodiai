# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-14)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 39 — Language-Aware Enforcement

## Current Position

Milestone: v0.7 Intelligent Review Content
Phase: 39 of 41 (Language-Aware Enforcement)
Plan: 4 of 4 complete
Status: Phase Complete
Last activity: 2026-02-14 — Completed 39-04 (enforcement pipeline integration into review handler)

Progress: [==========] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 83
- Average duration: 5 min
- Total execution time: 374 min

**By latest shipped milestone (v0.6):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 34-structured-review-template | 2 | 5 min | 3 min |
| 35-findings-organization-tone | 2 | 4 min | 2 min |
| 36-verdict-merge-confidence | 2 | 5 min | 3 min |
| 37-review-details-embedding | 2 | 4 min | 2 min |
| 38-delta-re-review-formatting | 2 | 5 min | 3 min |

## Accumulated Context

### Decisions

All decisions logged in `.planning/PROJECT.md` Key Decisions table. v0.6 decisions archived.

Recent decisions affecting current work:
- Research recommends extension-over-addition: extend existing pipelines, zero new dependencies
- Language severity floors enforced post-LLM (deterministic TypeScript, not prompt-driven)
- Feedback suppression default OFF (explicit opt-in via `.kodiai.yml`)
- Precedence: user suppressions > user minLevel > language overrides > default
- Go gofmt treated as always-on when go.mod exists (no config file needed)
- Tooling detection is fail-open: filesystem errors return empty maps, never block review
- Only style/documentation findings suppressable by tooling; correctness/security/performance never suppressed
- Keyword matching uses OR-of-AND groups for finding classification precision
- Enforcement runs between finding extraction and suppression matching in review pipeline
- toolingSuppressed flag merged back after severity floors (enforceSeverityFloors resets it)

### Pending Todos

None yet.

### Blockers/Concerns

None currently.

## Session Continuity

Last session: 2026-02-14
Stopped at: Completed 39-04-PLAN.md (phase 39 complete)
Resume file: None
Next action: Phase 39 verification or next phase

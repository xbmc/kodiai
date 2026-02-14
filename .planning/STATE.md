# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-14)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 41 — Feedback-Driven Learning

## Current Position

Milestone: v0.7 Intelligent Review Content
Phase: 41 of 41 (Feedback-Driven Learning)
Plan: 2 of 3 complete
Status: In Progress
Last activity: 2026-02-14 — Completed 41-02 (feedback aggregator and safety guard)

Progress: [======----] 67%

## Performance Metrics

**Velocity:**
- Total plans completed: 88
- Average duration: 4 min
- Total execution time: 389 min

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
- Duplicated FNV-1a hash into _feedbackFingerprint helper with fp- prefix to match review.ts, avoiding circular imports
- listFeedbackSuppressions delegates to aggregateFeedbackPatterns for identical logic with distinct API naming
- autoSuppress.enabled defaults to false (opt-in per FEED-08), thresholds default to 3/3/2 per FEED-09
- Safety guard protects CRITICAL (all categories) and MAJOR security/correctness from auto-suppression per FEED-04/FEED-05
- Confidence adjustment uses +10 per thumbs-up, -20 per thumbs-down with [0,100] clamping
- evaluateFeedbackSuppressions is fail-open: on store errors, logs warning and returns empty suppression set

### Pending Todos

None yet.

### Blockers/Concerns

None currently.

## Session Continuity

Last session: 2026-02-14
Stopped at: Completed 41-02-PLAN.md (feedback aggregator and safety guard)
Resume file: None
Next action: Execute 41-03-PLAN.md (pipeline integration)

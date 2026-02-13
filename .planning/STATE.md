# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-13)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Phase 38 - Delta Re-Review Formatting

## Current Position

Milestone: v0.6 Review Output Formatting & UX
Phase: 38 of 38 (Delta Re-Review Formatting)
Plan: 2 of 2 in current phase
Status: Phase 38 complete
Last activity: 2026-02-13 -- Completed 38-02 (delta re-review sanitizer validation)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 79
- Average duration: 5 min
- Total execution time: 359 min

**By latest shipped milestone (v0.5):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 30-state-memory-and-isolation-foundation | 3 | 10 min | 3 min |
| 31-incremental-re-review-with-retrieval-context | 3 | 11 min | 4 min |
| 32-multi-language-context-and-localized-output | 3 | 7 min | 2 min |
| 33-explainable-learning-and-delta-reporting | 3 | 7 min | 2 min |

## Accumulated Context

### Decisions

Decisions are logged in `.planning/PROJECT.md`.
All v0.5 decisions archived. v0.6 decisions will be listed here as they occur.

- **34-01:** Used comma-separated text for reviewed categories (not checkboxes); Strengths/Suggestions optional, What Changed/Observations/Verdict required; unknown category keys use key name as label for forward compatibility
- **34-02:** Severity sub-headings use ### prefix in Observations; Strengths content format not validated by sanitizer (prompt-driven); Observations validation scoped to section boundaries
- **35-01:** Severity tags are inline on finding lines not headings; PR labels in both context header and intent scoping; Preference capped at MEDIUM; Intent scoping and tone sections between Noise Suppression and Path Instructions
- **35-02:** ### Impact required, ### Preference optional; CRITICAL/MAJOR in Preference is soft warning not rejection; Bold markers stripped before severity tag matching; foundImpactFinding ensures at least one tagged finding exists
- **36-01:** Verdict Logic section placed after </details> but before hard requirements; buildVerdictLogicSection exported as standalone helper for testability
- **36-02:** blockerCount only counts CRITICAL/MAJOR under ### Impact (not Preference); red verdict without blockers is hard error, green verdict with blockers is soft warning
- **37-01:** FORMAT-13 output is exactly 4 data lines (files, lines changed +/-, findings by severity, timestamp); appendReviewDetailsToSummary finds summary by buildReviewOutputMarker; fallback from append to standalone on failure
- **37-02:** Regex matchers validate FORMAT-13 shape rather than simple toContain; negative assertions guard against old format fields reappearing
- **38-01:** Delta template replaces five-section template when deltaContext present; delta verdict uses transition states (green=improved, blue=unchanged, yellow=worsened); prior findings passed pre-execution for Claude to classify new/resolved/still-open
- **38-02:** Delta sanitizer validates structure only (sections, verdict format, headings); badges prompt-driven not sanitizer-enforced; discriminator chain uses passthrough pattern; forbidden section checks catch initial review sections leaking into delta

### Pending Todos

None yet.

### Blockers/Concerns

None currently.

## Session Continuity

Last session: 2026-02-13
Stopped at: Completed 38-02-PLAN.md (phase 38 complete)
Resume file: None

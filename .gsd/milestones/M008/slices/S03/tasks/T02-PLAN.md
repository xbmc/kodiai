# T02: 44-smart-finding-prioritization 02

**Slice:** S03 — **Milestone:** M008

## Description

Wire the Phase 44 prioritization engine into live review execution so comment caps are enforced by composite score with configurable weights and transparent reporting.

Purpose: This closes PRIOR-01 through PRIOR-04 in runtime behavior, ensuring deterministic high-value comment selection when findings exceed profile caps.

Output: Config support for prioritization weights, handler-level prioritization enforcement, and regression coverage for scoring/cap/disclosure behavior.

## Must-Haves

- [ ] "When visible findings exceed maxComments, only the highest composite-scored findings remain published"
- [ ] "Prioritization uses severity, file risk, category, and recurrence for runtime scoring"
- [ ] "Scoring weights can be configured in .kodiai.yml and defaults are applied safely"
- [ ] "Review Details includes prioritization stats: findings scored, top score, threshold score"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

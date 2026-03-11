# T01: 45-author-experience-adaptation 01

**Slice:** S04 — **Milestone:** M008

## Description

TDD: Implement the deterministic author classification logic and prompt tone section builder.

Purpose: Establish the pure-function core of author experience adaptation with full test coverage before wiring into the review pipeline. Classification maps author_association + optional PR count into three tiers (first-time, regular, core). The prompt section builder emits tier-specific tone directives.

Output: Tested classification module and prompt section builder ready for integration.

## Must-Haves

- [ ] "MEMBER and OWNER author_association values always classify as core tier"
- [ ] "FIRST_TIMER and FIRST_TIME_CONTRIBUTOR always classify as first-time tier"
- [ ] "NONE without PR count defaults to first-time (conservative)"
- [ ] "COLLABORATOR/CONTRIBUTOR without PR count defaults to regular"
- [ ] "PR count enrichment overrides ambiguous associations (<=1 first-time, 2-9 regular, >=10 core)"
- [ ] "MANNEQUIN is treated identically to NONE"
- [ ] "buildAuthorExperienceSection returns educational tone directives for first-time tier"
- [ ] "buildAuthorExperienceSection returns terse tone directives for core tier"
- [ ] "buildAuthorExperienceSection returns empty string for regular tier"

## Files

- `src/lib/author-classifier.ts`
- `src/lib/author-classifier.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`

---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T01: Refactor the review prompt builder into budgeted named sections

Split `buildReviewPromptDetails()` in `src/execution/review-prompt.ts` from a monolithic `lines: string[]` build into explicit prompt-section assembly that preserves the current review content order while exposing real section boundaries. Add local budgeting/truncation for the volatile expensive sections called out by research: changed-files/diff-shape context, large-PR/incremental/boundedness context, unified knowledge context (with legacy fallback only when unified data is absent), graph/structural impact evidence, and the instruction-heavy tail. Keep `promptKind: "review.user-prompt"` semantics unchanged; only the internal section accounting and enforced caps should change. Document any budget constants in code so later slices can adjust them without rediscovering the section map.

## Inputs

- ``src/execution/review-prompt.ts``
- ``src/execution/review-prompt.test.ts``
- ``src/execution/prompt-section-metrics.ts``

## Expected Output

- ``src/execution/review-prompt.ts``
- ``src/execution/review-prompt.test.ts``

## Verification

bun test src/execution/review-prompt.test.ts

## Observability Impact

Adds first-class section names and truncation flags to the review prompt metrics that later telemetry/report consumers persist unchanged.

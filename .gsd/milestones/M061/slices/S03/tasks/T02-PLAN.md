---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T02: Wire multi-section review prompt telemetry through initial and retry review execution

Update the review handler so both the normal review flow and the reduced-scope retry flow persist the new section arrays returned by `buildReviewPromptDetails()` without collapsing them back into one bucket. Add or extend handler tests to assert that `promptKind: "review.user-prompt"` remains stable while multiple named section rows are emitted for review execution, including truncation metadata when the prompt builder reports it. Keep the work wiring-only: the handler should consume the new prompt-builder contract rather than recomputing section metrics itself.

## Inputs

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``src/execution/review-prompt.ts``

## Expected Output

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``

## Verification

bun test src/handlers/review.test.ts

## Observability Impact

Keeps the S01 prompt-section telemetry path truthful on both initial and retry review executions by persisting the builder-produced section metrics unchanged.

---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T02: Implement bypass and graph-amplified validation gate

- Implement trivial-change bypass and optional second-pass validation for graph-amplified findings.
- Keep both behaviors configurable and fail-open.
- Wire the handler so graph or validation failure never blocks review completion.

## Inputs

- `src/handlers/review.ts`
- `src/review-graph/query.ts`
- `src/execution/review-prompt.ts`

## Expected Output

- `src/handlers/review.ts`
- `src/review-graph/validation.ts`
- `src/review-graph/validation.test.ts`

## Verification

bun test ./src/review-graph/validation.test.ts && bun run tsc --noEmit

## Observability Impact

Adds bypass decisions, validation attempts, and fail-open warning signals.

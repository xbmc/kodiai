---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T02: Integrate Structural Impact and breaking-change evidence

- Wire structural-impact rendering into the main review flow and Review Details generation.
- Use structural evidence to strengthen breaking-change output when caller/dependent data is present.
- Preserve fallback behavior when structural-impact data is absent or partial.

## Inputs

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/lib/structural-impact-formatter.ts`

## Expected Output

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`

## Verification

bun test ./src/execution/review-prompt.test.ts

## Observability Impact

Adds evidence-present vs fallback-used signals in the main review path.

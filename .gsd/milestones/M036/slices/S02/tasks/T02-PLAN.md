---
estimated_steps: 3
estimated_files: 5
skills_used: []
---

# T02: Inject sanitized active rules into the review prompt

- Add sanitization and bounded retrieval of active rules for prompt injection.
- Integrate active-rule lookup into the review prompt path without bypassing existing custom-instructions behavior.
- Add formatter/prompt tests for bounded rule injection.

## Inputs

- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `src/knowledge/store.ts`

## Expected Output

- `src/knowledge/active-rules.ts`
- `src/knowledge/active-rules.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`

## Verification

bun test ./src/execution/review-prompt.test.ts

## Observability Impact

Adds injected-rule counts, truncation counts, and sanitization result surfaces.

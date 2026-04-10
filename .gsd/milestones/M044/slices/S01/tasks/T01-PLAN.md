---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T01: Add shared reviewOutputKey parser and retry normalization

Extend the shipped marker/idempotency seam with additive parsing helpers that turn a GitHub-visible review-output key or marker into structured identity. Keep the existing builder and marker behavior intact. Cover base keys, retry-suffixed keys, malformed keys, and normalization rules so later audit code does not duplicate versioned regex logic or mis-correlate retries.

## Inputs

- `src/handlers/review-idempotency.ts`
- `src/handlers/review-idempotency.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`

## Expected Output

- `src/handlers/review-idempotency.ts`
- `src/handlers/review-idempotency.test.ts`

## Verification

bun test ./src/handlers/review-idempotency.test.ts

## Observability Impact

Expose structured parse results and explicit malformed-key outcomes that later audit/report code can surface verbatim instead of burying in ad-hoc parsing failures.

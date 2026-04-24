---
estimated_steps: 1
estimated_files: 5
skills_used: []
---

# T03: Add operator proof for section budgets and truncation visibility

Extend the operator proof surface so S03 can be re-verified without inspecting raw prompts. Add a dedicated verifier script/test pair that reuses the Postgres-backed usage-report query layer and checks for named `review.full / review.user-prompt / <section>` rows plus truncation evidence on review sections. Update any usage-report fixtures/tests needed so the canonical reporting surface remains aligned with the new review section names instead of assuming a single review block. The proof should fail open when Postgres access is unavailable, matching the S01 operator pattern.

## Inputs

- ``scripts/usage-report.ts``
- ``scripts/usage-report.test.ts``
- ``scripts/verify-m061-s01.ts``
- ``src/handlers/review.ts``
- ``src/execution/review-prompt.ts``

## Expected Output

- ``scripts/verify-m061-s03.ts``
- ``scripts/verify-m061-s03.test.ts``
- ``scripts/usage-report.test.ts``

## Verification

bun test scripts/usage-report.test.ts scripts/verify-m061-s03.test.ts && bun scripts/verify-m061-s03.ts --json

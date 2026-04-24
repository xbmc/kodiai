---
estimated_steps: 1
estimated_files: 5
skills_used: []
---

# T03: Add deterministic canonical-state verifier coverage for authority outcomes

Create a verifier/query path that exercises the canonical family store directly and proves the slice demo scenarios from durable state: merge, quiet-settlement, blocked/no-follow-up, and superseded stale-attempt suppression. Reuse the M063 verification style but make canonical state—not comment bodies or telemetry rows—the answer source. Add scenario-driven tests for the verifier so the contract stays machine-checkable and maps back to R067, R071, R072, and R073.

## Inputs

- ``scripts/verify-m063-s01.ts``
- ``scripts/verify-m063-s02.ts``
- ``src/knowledge/types.ts``
- ``src/knowledge/store.ts``
- ``src/handlers/review.test.ts``

## Expected Output

- ``scripts/verify-m064-s01.ts``
- ``scripts/verify-m064-s01.test.ts``
- ``src/knowledge/types.ts``
- ``src/knowledge/store.ts``

## Verification

bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json

## Observability Impact

Introduces the operator-proof inspection command for this slice; verifier output should name the canonical family row and show authoritative outcome, stop reason, attempt id, and projection status.

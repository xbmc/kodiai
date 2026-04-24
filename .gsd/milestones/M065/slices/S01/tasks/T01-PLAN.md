---
estimated_steps: 15
estimated_files: 3
skills_used: []
---

# T01: Define the M065 composed report contract and failing composition tests

Expected executor skills: `test-driven-development`, `systematic-debugging`, `verify-before-complete`.

Write the failing contract tests first. Steps:
1. Add `scripts/verify-m065.test.ts` covering parse args, stable top-level check ids, JSON shape, human output, nested report preservation, and package script wiring.
2. In those tests, stub the M062/M063/M064 evaluators so the M065 harness is forced to treat their reports as authoritative nested payloads rather than recomputing their conclusions.
3. Add negative tests for malformed nested reports, nested failures, and the case where live-proof/regression obligations are still pending so the top-level verifier stays honest about incomplete rollout proof.
4. Assert that the human report names the failing nested contract and points to the next drill-down command, not just a flattened summary.

Must-haves:
- Top-level checks include one per nested prerequisite plus explicit M065 live-proof and fresh-regression obligation checks.
- JSON report preserves intact nested report objects for M062/M063/M064 and exposes machine-readable drill-down metadata.
- Pending future obligations are modeled as data/skipped checks, not silently omitted.

Verification:
- `bun test scripts/verify-m065.test.ts`
- `bun test scripts/verify-m065.test.ts -t "stable top-level check ids"`

Done when:
- The new test file fails before implementation and fully describes the composed verifier contract with no placeholder assertions.

## Inputs

- ``scripts/verify-m046.ts``
- ``scripts/verify-m062-s03.ts``
- ``scripts/verify-m062-s03.test.ts``
- ``scripts/verify-m063-s03.ts``
- ``scripts/verify-m063-s03.test.ts``
- ``scripts/verify-m064-s03.ts``
- ``scripts/verify-m064-s03.test.ts``
- ``package.json``

## Expected Output

- ``scripts/verify-m065.test.ts``
- ``scripts/verify-m065.ts``

## Verification

bun test scripts/verify-m065.test.ts

## Observability Impact

Pins the top-level failure-localization contract: named M065 check ids, preserved nested status codes, and drill-down commands must be visible in JSON and human output.

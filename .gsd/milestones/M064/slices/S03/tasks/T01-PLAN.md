---
estimated_steps: 1
estimated_files: 6
skills_used: []
---

# T01: Add canonical operator-evidence resolver and report builder

Build the shared read-side seam for S03 so downstream scripts can answer from canonical continuation-family state without operators reconstructing raw DB keys by hand. Reuse the existing review-output-key and family-key contracts instead of introducing a rival identity scheme or search API. Add focused unit tests for lookup resolution, missing-row behavior, malformed reviewOutputKey input, and canonical-state-to-report mapping for canonical, degraded, pending, and superseded lifecycle states. Keep the report builder separate from CLI concerns so later milestone work can reuse it directly.

## Inputs

- ``src/knowledge/types.ts``
- ``src/knowledge/store.ts``
- ``src/handlers/review-idempotency.ts``
- ``src/jobs/review-work-coordinator.ts``
- ``scripts/verify-m064-s01.ts``
- ``scripts/verify-m064-s02.ts``

## Expected Output

- ``src/knowledge/continuation-operator-evidence.ts``
- ``src/knowledge/continuation-operator-evidence.test.ts``
- ``src/knowledge/types.ts``

## Verification

bun test src/knowledge/continuation-operator-evidence.test.ts

## Observability Impact

Introduces the reusable operator-facing evidence object that future scripts inspect. Failures must preserve explicit lookup/report status for invalid identity input, missing canonical rows, and degraded or pending projections rather than forcing callers to infer state from absence.
